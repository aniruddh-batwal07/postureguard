"""PostureGuard continuous background CV daemon (M2 redesign).

Polls GET /api/sessions/active continuously and manages internal CV states:
- STANDBY: No active session. Violation evaluation disabled.
- ATTACHED_UNCONFIGURED: Active session attached; baseline not configured.
- CAPTURING_BASELINE: User requested baseline; samples upright pose & posts baseline_captured.
- MONITORING_ACTIVE: Baseline configured; evaluates SlouchRule against baseline metrics.
"""

from __future__ import annotations

import sys
import time
from typing import Any, Callable

from cv.camera import Camera, CameraError
from cv.config import Config
from cv.debug import PreviewRenderer
from cv.events import EventClient, EventClientError
from cv.pose import (
    BaselineCaptureError,
    PoseDetector,
    PostureBaseline,
    capture_baseline,
    extract_posture_measurement,
)
from cv.rules import SlouchRule
from cv.settings import CvSettings, SettingsPoller

STATE_STANDBY = "STANDBY"
STATE_ATTACHED_UNCONFIGURED = "ATTACHED_UNCONFIGURED"
STATE_CAPTURING_BASELINE = "CAPTURING_BASELINE"
STATE_MONITORING_ACTIVE = "MONITORING_ACTIVE"

EVENT_BASELINE_CAPTURED = "baseline_captured"


def short_id(session_id: str | None) -> str:
    if not session_id:
        return ""
    return session_id[:8] if len(session_id) >= 8 else session_id


def parse_baseline_dict(raw_bl: dict[str, Any] | None) -> PostureBaseline | None:
    if not isinstance(raw_bl, dict):
        return None
    try:
        head_forward = float(
            raw_bl.get("headForward") if "headForward" in raw_bl else raw_bl["head_forward"]
        )
        head_drop = float(
            raw_bl.get("headDrop") if "headDrop" in raw_bl else raw_bl["head_drop"]
        )
        shoulder_roll = float(
            raw_bl.get("shoulderRoll") if "shoulderRoll" in raw_bl else raw_bl["shoulder_roll"]
        )
        sample_count = int(
            raw_bl.get("sampleCount") if "sampleCount" in raw_bl else raw_bl["sample_count"]
        )
        return PostureBaseline(
            head_forward=head_forward,
            head_drop=head_drop,
            shoulder_roll=shoulder_roll,
            sample_count=sample_count,
        )
    except (KeyError, TypeError, ValueError):
        return None


def forward_rule_event(
    client: EventClient,
    event: str,
    session_id: str,
    data: dict[str, Any] | None = None,
) -> None:
    try:
        client.send_event(event, session_id, data=data)
        print(f"[cv] event sent: {event}", flush=True)
    except EventClientError as err:
        print(
            f"[cv] failed to forward event '{event}': {err}",
            file=sys.stderr,
            flush=True,
        )


class CvDaemon:
    def __init__(
        self,
        config: Config,
        client: EventClient,
        camera: Camera,
        detector: PoseDetector,
        settings_poller: SettingsPoller,
        preview: PreviewRenderer | None = None,
        poll_interval: float = 1.0,
        baseline_min_samples: int = 30,
        baseline_max_seconds: float = 5.0,
        frame_delay: float = 0.05,
        time_fn: Callable[[], float] = time.monotonic,
    ) -> None:
        self.config = config
        self.client = client
        self.camera = camera
        self.detector = detector
        self.settings_poller = settings_poller
        self.preview = preview
        self.poll_interval = poll_interval
        self.baseline_min_samples = baseline_min_samples
        self.baseline_max_seconds = baseline_max_seconds
        self.frame_delay = frame_delay
        self.time_fn = time_fn

        self.state = STATE_STANDBY
        self.session_id: str | None = None
        self.baseline_state: str = "unconfigured"
        self.baseline: PostureBaseline | None = None
        self.rule: SlouchRule | None = None
        self.backend_available: bool = True
        self.last_poll_time: float = 0.0

    def _reset_to_standby(self) -> None:
        if self.state != STATE_STANDBY:
            print("[cv] state: standby", flush=True)
        self.state = STATE_STANDBY
        self.session_id = None
        self.baseline_state = "unconfigured"
        self.baseline = None
        self.rule = None

    def _attach_session(self, new_id: str) -> None:
        print(f"[cv] attached to session {short_id(new_id)}", flush=True)
        self.session_id = new_id
        self.baseline_state = "unconfigured"
        self.baseline = None
        self.rule = None
        self.state = STATE_ATTACHED_UNCONFIGURED

    def _build_rule(self, baseline: PostureBaseline) -> SlouchRule:
        settings = self.settings_poller.current_settings
        return SlouchRule(
            baseline.to_measurement(),
            slouch_threshold=settings.slouchThreshold,
            slouch_duration_seconds=settings.slouchDurationSeconds,
            correction_duration_seconds=settings.correctionDurationSeconds,
        )

    def poll_session(self) -> tuple[str, dict[str, Any] | None]:
        try:
            res = self.client.request("GET", "/api/sessions/active")
            if not self.backend_available:
                self.backend_available = True
                print("[cv] backend connected", flush=True)
            return ("ok", res.get("session"))
        except EventClientError as err:
            if self.backend_available:
                self.backend_available = False
                print(f"[cv] backend unavailable: {err}", file=sys.stderr, flush=True)
            return ("error", None)

    def update_session_state(self, status: str, session: dict[str, Any] | None) -> None:
        if status == "error":
            # Retain safe transient local state when backend is offline
            return

        if session is None or session.get("state") == "ended":
            if self.session_id is not None:
                print("[cv] session ended", flush=True)
            self._reset_to_standby()
            return

        sid = str(session.get("id", ""))
        if not sid:
            self._reset_to_standby()
            return

        if self.session_id != sid:
            self._attach_session(sid)

        b_state = session.get("baselineState", "unconfigured")
        b_data = session.get("baseline")

        if b_state == "unconfigured":
            if self.baseline_state in ("configured", "capturing") or self.baseline is not None:
                print("[cv] baseline reset", flush=True)
            self.baseline_state = "unconfigured"
            self.baseline = None
            self.rule = None
            self.state = STATE_ATTACHED_UNCONFIGURED

        elif b_state == "capturing":
            if self.state != STATE_CAPTURING_BASELINE:
                print("[cv] baseline capture requested", flush=True)
                self.state = STATE_CAPTURING_BASELINE
                self.baseline_state = "capturing"
                self.run_baseline_capture()

        elif b_state == "configured":
            parsed_bl = parse_baseline_dict(b_data) if b_data else self.baseline
            if parsed_bl is not None:
                if self.state != STATE_MONITORING_ACTIVE or self.baseline != parsed_bl or self.rule is None:
                    self.baseline = parsed_bl
                    self.rule = self._build_rule(parsed_bl)
                    self.state = STATE_MONITORING_ACTIVE
                    self.baseline_state = "configured"
                    print(
                        f"[cv] monitoring active: threshold={self.rule.slouch_threshold:.2f}, "
                        f"slouch_duration={self.rule.slouch_duration_seconds:.1f}s, "
                        f"correction_duration={self.rule.correction_duration_seconds:.1f}s",
                        flush=True,
                    )

    def run_baseline_capture(self) -> None:
        if not self.session_id:
            return
        starting_session_id = self.session_id
        try:
            def progress(collected: int, required: int) -> None:
                print(f"[cv] Baseline: {collected}/{required} valid samples", flush=True)

            baseline = capture_baseline(
                self.camera,
                self.detector,
                min_samples=self.baseline_min_samples,
                max_seconds=self.baseline_max_seconds,
                progress=progress,
                preview=self.preview,
            )
            # Abort if session changed during capture
            if self.session_id != starting_session_id:
                print("[cv] session changed during baseline capture, aborting", flush=True)
                return

            print(
                f"[cv] baseline captured from {baseline.sample_count} samples: "
                f"head_forward={baseline.head_forward:.2f} "
                f"head_drop={baseline.head_drop:.2f} "
                f"shoulder_roll={baseline.shoulder_roll:.2f}",
                flush=True,
            )
            self.baseline = baseline
            forward_rule_event(
                self.client,
                EVENT_BASELINE_CAPTURED,
                self.session_id,
                data=baseline.to_dict(),
            )
        except (BaselineCaptureError, CameraError) as err:
            print(f"[cv] baseline capture failed: {err}", file=sys.stderr, flush=True)
            self.state = STATE_ATTACHED_UNCONFIGURED
            self.baseline_state = "unconfigured"

    def step_frame(self) -> None:
        if not self.camera.is_open:
            return

        try:
            frame = self.camera.read()
        except CameraError as err:
            print(f"[cv] frame read error: {err}", file=sys.stderr, flush=True)
            return

        if self.state == STATE_MONITORING_ACTIVE and self.rule is not None and self.session_id:
            if self.settings_poller.poll():
                if self.baseline is not None:
                    self.rule = self._build_rule(self.baseline)
                    print("[cv] rule updated with new settings", flush=True)

            landmarks = self.detector.detect(frame)
            measurement = extract_posture_measurement(landmarks) if landmarks is not None else None
            for event in self.rule.update(measurement, self.time_fn()):
                forward_rule_event(self.client, event, self.session_id)
        elif self.preview is not None:
            landmarks = self.detector.detect(frame) if self.session_id else None
            self.preview.render(frame, landmarks)

    def run_loop(self, max_iterations: int | None = None) -> None:
        if not self.camera.is_open:
            self.camera.open()
        self.detector.initialize()

        iterations = 0
        print(f"[cv] daemon running (poll_interval={self.poll_interval:.1f}s)", flush=True)

        try:
            while max_iterations is None or iterations < max_iterations:
                now = self.time_fn()
                if now - self.last_poll_time >= self.poll_interval or self.last_poll_time == 0.0:
                    status, session = self.poll_session()
                    self.update_session_state(status, session)
                    self.last_poll_time = now

                self.step_frame()
                iterations += 1
                time.sleep(self.frame_delay)
        finally:
            self.close()

    def close(self) -> None:
        if self.preview is not None:
            self.preview.close()
        if hasattr(self.detector, "close"):
            self.detector.close()
        self.camera.release()

