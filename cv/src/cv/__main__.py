"""PostureGuard CV service entry point (M2.1: camera + events; M2.2: pose baseline; M2.3: slouch rules; M3.1: event forwarding; M3.3: live settings)."""

from __future__ import annotations

import argparse
import os
import signal
import sys
import time
from typing import Any, Callable

if sys.platform == "win32":
    local_temp = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".tmp"))
    os.makedirs(local_temp, exist_ok=True)
    os.environ.setdefault("MPLCONFIGDIR", os.path.join(local_temp, "matplotlib"))
    os.environ.setdefault("TEMP", local_temp)
    os.environ.setdefault("TMP", local_temp)

_src_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _src_dir not in sys.path:
    sys.path.insert(0, _src_dir)

from cv import __version__
from cv.camera import Camera, CameraError
from cv.config import Config
from cv.debug import PreviewRenderer
from cv.events import EventClient, EventClientError
from cv.pose import (
    BaselineCaptureError,
    PoseDetectionError,
    PoseDetector,
    PostureBaseline,
    PostureMeasurement,
    calculate_deviation,
    capture_baseline,
    extract_posture_measurement,
)
from cv.rules import SlouchRule

# M4.2: posted to the backend once an upright-posture baseline has been captured
# with enough valid samples. The backend moves the session from
# baseline_capturing to monitoring on receipt (architecture.md §5.2).
EVENT_BASELINE_CAPTURED = "baseline_captured"


class _StopRequested(Exception):
    pass


def resolve_active_session(client: EventClient, timeout_seconds: float = 30.0) -> dict[str, Any]:
    """Return the backend's active session, creating one if none exists."""
    deadline = time.monotonic() + timeout_seconds
    while True:
        try:
            session = client.request("GET", "/api/sessions/active").get("session")
            if session is None:
                session = client.request("POST", "/api/sessions")["session"]
            return session
        except EventClientError:
            if time.monotonic() >= deadline:
                raise
            print(f"[cv] Waiting for backend at {client.base_url} to be ready...", flush=True)
            time.sleep(1.0)


def report_baseline_progress(collected: int, required: int) -> None:
    """Print one calibration progress line, e.g. ``Baseline: 7/30 valid samples``."""
    print(f"[cv] Baseline: {collected}/{required} valid samples", flush=True)


def forward_rule_event(
    client: EventClient,
    event: str,
    session_id: str,
    data: dict[str, Any] | None = None,
) -> str:
    """Forward one rule event to the backend.

    A backend/network failure is logged to stderr and swallowed so a transient
    outage never crashes the capture loop (M3.1 reliability requirement).
    Returns the active session ID (re-resolved if stale).
    """
    try:
        client.send_event(event, session_id, data=data)
        print(f"[cv] event sent: {event}", flush=True)
        return session_id
    except EventClientError as err:
        print(
            f"[cv] failed to forward event '{event}': {err}",
            file=sys.stderr,
            flush=True,
        )
        try:
            active = resolve_active_session(client)
            new_id = str(active["id"])
            if new_id != session_id:
                print(f"[cv] switching to new active session {new_id}", flush=True)
                client.send_event(event, new_id, data=data)
                print(f"[cv] event sent: {event}", flush=True)
                return new_id
        except Exception:
            pass
        return session_id


def capture_baseline_for_rule(
    camera: Camera,
    detector: PoseDetector,
    min_samples: int,
    max_seconds: float,
    preview: PreviewRenderer | None = None,
) -> PostureBaseline:
    """Capture the upright baseline so ``run()`` can build the slouch rule.

    Computes the per-session baseline from live frames (M2.2). The completed
    baseline is announced to the backend as a ``baseline_captured`` event by
    ``run()`` so the session can move to ``monitoring``; a failed baseline
    raises here and nothing is posted. The caller sees the failure reason when
    the baseline cannot be captured.

    Returns:
        PostureBaseline, so the caller can configure the M2.3 slouch rule.
    """
    try:
        baseline = capture_baseline(
            camera,
            detector,
            min_samples=min_samples,
            max_seconds=max_seconds,
            progress=report_baseline_progress,
            preview=preview,
        )
        print(
            f"[cv] baseline captured from {baseline.sample_count} samples: "
            f"head_forward={baseline.head_forward:.2f} "
            f"head_drop={baseline.head_drop:.2f} "
            f"shoulder_roll={baseline.shoulder_roll:.2f}",
            flush=True,
        )
        return baseline
    except (BaselineCaptureError, CameraError) as err:
        print(f"[cv] baseline failed: {err}", file=sys.stderr, flush=True)
        raise


def _build_rule_from_config(baseline: PostureBaseline, config: Config) -> SlouchRule:
    """Build a SlouchRule from a Config object (env-based defaults)."""
    return SlouchRule(
        baseline.to_measurement(),
        slouch_threshold=config.slouch_threshold,
        slouch_duration_seconds=config.slouch_duration_seconds,
        correction_duration_seconds=config.correction_duration_seconds,
    )


def _build_rule_from_settings(baseline: PostureBaseline, settings: Any) -> SlouchRule:
    """Build a SlouchRule from a CvSettings object (live backend settings)."""
    return SlouchRule(
        baseline.to_measurement(),
        slouch_threshold=settings.slouchThreshold,
        slouch_duration_seconds=settings.slouchDurationSeconds,
        correction_duration_seconds=settings.correctionDurationSeconds,
    )


def _log_rule_params(threshold: float, slouch_dur: float, correction_dur: float) -> None:
    print(
        f"[cv] monitoring: threshold={threshold:.2f}, "
        f"slouch_duration={slouch_dur:.1f}s, "
        f"correction_duration={correction_dur:.1f}s",
        flush=True,
    )


def _parse_baseline_from_session(raw_baseline: Any) -> PostureBaseline | None:
    """Extract a valid PostureBaseline from session dictionary if available."""
    if not isinstance(raw_baseline, dict):
        return None
    try:
        hf = float(raw_baseline.get("head_forward", raw_baseline.get("headForward", 0.0)))
        hd = float(raw_baseline.get("head_drop", raw_baseline.get("headDrop", 0.0)))
        sr = float(raw_baseline.get("shoulder_roll", raw_baseline.get("shoulderRoll", 0.0)))
        count = int(raw_baseline.get("sample_count", raw_baseline.get("sampleCount", 30)))
        return PostureBaseline(
            head_forward=hf,
            head_drop=hd,
            shoulder_roll=sr,
            sample_count=count,
        )
    except Exception:
        return None


def run(
    config: Config,
    client: EventClient,
    camera: Camera,
    max_frames: int | None = None,
    frame_delay: float = 0.05,
    detector: PoseDetector | None = None,
    baseline_min_samples: int = 30,
    baseline_max_seconds: float = 5.0,
    preview_enabled: bool = True,
    time_fn: Callable[[], float] = time.monotonic,
    settings_poller: Any | None = None,
) -> str:
    """Open the camera, resolve a session, and capture until stopped.

    When ``detector`` is provided, the session baseline feeds an M2.3
    ``SlouchRule``: a successful capture forwards ``baseline_captured`` so the
    backend moves the session to ``monitoring`` (M4.2), and each monitoring
    frame updates the rule — when a violation or recovery has been sustained
    for its configured duration the event is forwarded to the backend via
    ``POST /api/events`` (M3.1). A failed forward is logged and the loop
    continues; it never crashes the service.

    When ``settings_poller`` is provided (M3.3), the monitoring loop calls
    ``poller.poll()`` on each frame and rebuilds the ``SlouchRule`` with the
    same baseline but updated parameters whenever settings change.  The poller
    swallows its own network / validation errors so a transient backend outage
    never interrupts monitoring.

    When ``preview_enabled`` is True, a development-only preview window shows
    the webcam feed with detected landmarks and calibration progress while the
    baseline is being captured.

    ``time_fn`` provides the monotonic clock used by the slouch rule (injectable
    for deterministic tests).
    """
    preview = PreviewRenderer() if preview_enabled else None
    session_id = ""
    rule: SlouchRule | None = None
    baseline_result: PostureBaseline | None = None
    try:
        try:
            camera.open()
            camera.read()
        except CameraError:
            if preview is not None:
                preview.close()
            raise
        print(f"[cv] camera {config.camera_index} open and capturing", flush=True)

        session = resolve_active_session(client)
        session_id = str(session["id"])

        if settings_poller is not None:
            # Fetch the latest backend settings up front so the first rule (and
            # monitoring without a detector) starts from current values. A
            # transient backend outage leaves the config-based settings active.
            settings_poller.poll()

        if detector is not None:
            detector.initialize()
            configured_baseline = None
            if session.get("baselineState") == "configured" and session.get("baseline"):
                configured_baseline = _parse_baseline_from_session(session.get("baseline"))

            if configured_baseline is not None:
                baseline_result = configured_baseline
                print(
                    f"[cv] Using pre-configured baseline: "
                    f"head_forward={baseline_result.head_forward:.2f} "
                    f"head_drop={baseline_result.head_drop:.2f} "
                    f"shoulder_roll={baseline_result.shoulder_roll:.2f} "
                    f"({baseline_result.sample_count} samples)",
                    flush=True,
                )
            else:
                baseline_result = capture_baseline_for_rule(
                    camera,
                    detector,
                    baseline_min_samples,
                    baseline_max_seconds,
                    preview=preview,
                )
                # Baseline captured: notify backend
                print("[cv] Upright baseline captured! Starting slouch monitoring...", flush=True)
                session_id = forward_rule_event(client, EVENT_BASELINE_CAPTURED, session_id, data=baseline_result.to_dict())

            print("[cv] Arm confirmed at base position. Starting slouch monitoring...", flush=True)
            if hasattr(camera, "_capture") and camera._capture is not None:
                for _ in range(5):
                    try:
                        camera._capture.grab()
                    except Exception:
                        break

            if settings_poller is not None:
                live = settings_poller.current_settings
                rule = _build_rule_from_settings(baseline_result, live)
            else:
                rule = _build_rule_from_config(baseline_result, config)
            _log_rule_params(
                rule.slouch_threshold,
                rule.slouch_duration_seconds,
                rule.correction_duration_seconds,
            )
        else:
            print(f"[cv] no pose detector; monitoring disabled for session {session_id}", flush=True)

        frames = 0
        consecutive_cam_errors = 0
        consecutive_dropped_frames = 0
        consecutive_glitch_frames = 0
        last_valid_measurement = None
        last_slouch_measurement = None
        last_good_measurement = None
        while max_frames is None or frames < max_frames:
            try:
                frame = camera.read()
                consecutive_cam_errors = 0
            except CameraError:
                consecutive_cam_errors += 1
                if consecutive_cam_errors % 10 == 0:
                    print(
                        f"[cv] camera read error ({consecutive_cam_errors} consecutive), attempting reconnect...",
                        file=sys.stderr,
                        flush=True,
                    )
                    try:
                        camera.release()
                        time.sleep(0.3)
                        camera.open()
                        print("[cv] camera successfully reconnected", flush=True)
                        consecutive_cam_errors = 0
                    except Exception as rec_err:
                        print(f"[cv] camera reconnect failed: {rec_err}", file=sys.stderr, flush=True)
                if consecutive_cam_errors > 60:
                    raise
                time.sleep(frame_delay)
                continue

            # M3.3: poll for settings updates on each frame; rebuild rule when changed.
            if settings_poller is not None and baseline_result is not None and rule is not None:
                if settings_poller.poll():
                    live = settings_poller.current_settings
                    rule = _build_rule_from_settings(baseline_result, live)
                    print(
                        "[cv] rule updated with new settings",
                        flush=True,
                    )

            # Periodically (every 20 frames, ~1s) verify active session status and handle dashboard recalibration
            if frames > 0 and frames % 20 == 0:
                try:
                    active_sess_data = client.request("GET", "/api/sessions/active").get("session")
                    if active_sess_data is None or str(active_sess_data.get("id")) != session_id or active_sess_data.get("state") == "ended":
                        print(f"[cv] active session {session_id} ended or changed; stopping cv pipeline", flush=True)
                        break

                    if active_sess_data.get("baselineState") == "capturing" and detector is not None:
                        print("[cv] recalibration requested from dashboard! Capturing new baseline...", flush=True)
                        baseline_result = capture_baseline_for_rule(
                            camera,
                            detector,
                            baseline_min_samples,
                            baseline_max_seconds,
                            preview=preview,
                        )
                        session_id = forward_rule_event(
                            client,
                            EVENT_BASELINE_CAPTURED,
                            session_id,
                            data=baseline_result.to_dict(),
                        )
                        if settings_poller is not None:
                            rule = _build_rule_from_settings(baseline_result, settings_poller.current_settings)
                        else:
                            rule = _build_rule_from_config(baseline_result, config)
                        print("[cv] new baseline established and active!", flush=True)
                except Exception:
                    pass

            landmarks = None
            if rule is not None:
                try:
                    landmarks = detector.detect(frame)
                    raw_measurement = (
                        extract_posture_measurement(landmarks) if landmarks is not None else None
                    )
                    if raw_measurement is not None:
                        consecutive_dropped_frames = 0
                        last_valid_measurement = raw_measurement
                        candidate_measurement = raw_measurement
                    else:
                        consecutive_dropped_frames += 1
                        # Tolerate up to 10 momentary dropped frames (~500ms) before declaring unknown
                        if consecutive_dropped_frames <= 10 and last_valid_measurement is not None:
                            candidate_measurement = last_valid_measurement
                        else:
                            candidate_measurement = None

                    # Glitch suppression: prevent single-frame landmark coordinate jitter from
                    # resetting an active sustained slouch or correction countdown.
                    measurement = candidate_measurement
                    if candidate_measurement is not None:
                        dev = calculate_deviation(candidate_measurement, rule.baseline)
                        is_bad = dev.magnitude() > rule.slouch_threshold

                        # Active slouch countdown: user is slouching, waiting for 2.0s trigger
                        if not rule.slouch_active and rule.slouch_since is not None:
                            if is_bad:
                                consecutive_glitch_frames = 0
                                last_slouch_measurement = candidate_measurement
                                measurement = candidate_measurement
                            else:
                                if consecutive_glitch_frames < 2 and last_slouch_measurement is not None:
                                    consecutive_glitch_frames += 1
                                    measurement = last_slouch_measurement
                                else:
                                    consecutive_glitch_frames = 0
                                    measurement = candidate_measurement

                        # Active correction countdown: screen is blocked, user is holding good posture
                        elif rule.slouch_active and rule.correction_since is not None:
                            if not is_bad:
                                consecutive_glitch_frames = 0
                                last_good_measurement = candidate_measurement
                                measurement = candidate_measurement
                            else:
                                if consecutive_glitch_frames < 2 and last_good_measurement is not None:
                                    consecutive_glitch_frames += 1
                                    measurement = last_good_measurement
                                else:
                                    consecutive_glitch_frames = 0
                                    measurement = candidate_measurement

                        # Steady state or initial sample
                        else:
                            consecutive_glitch_frames = 0
                            if is_bad:
                                last_slouch_measurement = candidate_measurement
                            else:
                                last_good_measurement = candidate_measurement
                            measurement = candidate_measurement
                    else:
                        consecutive_glitch_frames = 0

                    for event in rule.update(measurement, time_fn()):
                        session_id = forward_rule_event(client, event, session_id)
                        consecutive_glitch_frames = 0
                        last_valid_measurement = None
                        last_slouch_measurement = None
                        last_good_measurement = None
                        if hasattr(camera, "_capture") and camera._capture is not None:
                            for _ in range(5):
                                try:
                                    camera._capture.grab()
                                except Exception:
                                    break
                except Exception as err:
                    print(f"[cv] warning: error in frame processing: {err}", file=sys.stderr, flush=True)

            if preview is not None and preview.enabled:
                cond = rule.condition if rule is not None else "monitoring"
                status_text = f"Posture: {cond.upper()}"
                if rule and rule.slouch_active:
                    if rule.correction_since is not None:
                        elapsed = time_fn() - rule.correction_since
                        status_text = f"Correcting Posture: {elapsed:.1f}s / {rule.correction_duration_seconds:.1f}s"
                    else:
                        status_text = "SLOUCH DETECTED - ARM BLOCKED"
                elif rule and rule.slouch_since is not None:
                    elapsed = time_fn() - rule.slouch_since
                    status_text = f"Slouching: {elapsed:.1f}s / {rule.slouch_duration_seconds:.1f}s"

                key = preview.render(
                    frame,
                    landmarks=landmarks,
                    status=status_text,
                )
                if key is not None and (key & 0xFF) in (ord("q"), ord("Q"), 27):
                    print("[cv] user requested exit from preview window", flush=True)
                    raise _StopRequested()

            frames += 1
            time.sleep(frame_delay)
    except _StopRequested:
        pass
    finally:
        camera.release()
        if preview is not None:
            preview.close()
    return session_id


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="postureguard-cv",
        description="PostureGuard computer vision service (M3.3: live settings).",
    )
    parser.add_argument(
        "--no-preview",
        action="store_true",
        help="disable the development webcam preview window",
    )
    parser.add_argument(
        "--min-samples",
        type=int,
        default=30,
        help="valid upper-body samples required for the baseline (default: 30)",
    )
    parser.add_argument(
        "--max-seconds",
        type=float,
        default=20.0,
        help="baseline capture timeout in seconds (default: 20.0)",
    )
    args = parser.parse_args()

    config = Config.from_env()
    client = EventClient(config.backend_url)
    camera = Camera(config.camera_index)
    detector = PoseDetector(landmark_visibility_threshold=0.35)

    # M3.3: create a poller using config defaults as the initial settings so the
    # service starts monitoring even if the backend is temporarily unavailable.
    from cv.settings import CvSettings, SettingsPoller  # noqa: PLC0415

    initial_settings = CvSettings(
        slouchThreshold=config.slouch_threshold,
        slouchDurationSeconds=config.slouch_duration_seconds,
        correctionDurationSeconds=config.correction_duration_seconds,
    )
    settings_poller = SettingsPoller(client, initial_settings=initial_settings)

    def _on_signal(_signum: int, _frame: Any) -> None:
        raise _StopRequested()

    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    max_baseline_retries = 3
    try:
        for attempt in range(max_baseline_retries):
            try:
                run(
                    config,
                    client,
                    camera,
                    detector=detector,
                    baseline_min_samples=args.min_samples,
                    baseline_max_seconds=args.max_seconds,
                    preview_enabled=not args.no_preview,
                    settings_poller=settings_poller,
                )
                break
            except _StopRequested:
                break
            except BaselineCaptureError as err:
                if attempt < max_baseline_retries - 1:
                    print(
                        f"\n[cv] Baseline capture timed out ({err}).\n"
                        f"[cv] Retrying baseline ({attempt + 2}/{max_baseline_retries})... Please sit upright and ensure your head and shoulders are visible to the webcam.\n",
                        flush=True,
                    )
                    time.sleep(2.0)
                else:
                    print(f"[cv] baseline/vision error: {err}", file=sys.stderr, flush=True)
                    return 3
            except CameraError as err:
                if attempt < max_baseline_retries - 1:
                    print(f"[cv] camera error ({err}), retrying in 2 seconds...", file=sys.stderr, flush=True)
                    time.sleep(2.0)
                else:
                    print(f"[cv] camera error: {err}", file=sys.stderr, flush=True)
                    return 1
            except EventClientError as err:
                if attempt < max_baseline_retries - 1:
                    print(f"[cv] backend error ({err}), retrying in 2 seconds...", file=sys.stderr, flush=True)
                    time.sleep(2.0)
                else:
                    print(f"[cv] backend error: {err}", file=sys.stderr, flush=True)
                    return 2
            except PoseDetectionError as err:
                print(f"[cv] baseline/vision error: {err}", file=sys.stderr, flush=True)
                return 3
            except KeyError as err:
                print(f"[cv] backend error: missing key {err}", file=sys.stderr, flush=True)
                return 2
            except Exception as err:
                print(f"[cv] unexpected error: {err}", file=sys.stderr, flush=True)
                import traceback
                traceback.print_exc()
                return 1
    finally:
        detector.close()
        camera.release()

    print(f"[cv] postureguard-cv {__version__} stopped cleanly", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())