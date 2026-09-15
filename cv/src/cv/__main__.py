"""PostureGuard CV service entry point (M2.1: camera + events; M2.2: pose baseline; M2.3: slouch rules; M3.1: event forwarding)."""

from __future__ import annotations

import argparse
import signal
import sys
import time
from typing import Any, Callable

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
    capture_baseline,
    extract_posture_measurement,
)
from cv.rules import SlouchRule


class _StopRequested(Exception):
    pass


def resolve_active_session(client: EventClient) -> dict[str, Any]:
    """Return the backend's active session, creating one if none exists."""
    session = client.request("GET", "/api/sessions/active").get("session")
    if session is None:
        session = client.request("POST", "/api/sessions")["session"]
    return session


def report_baseline_progress(collected: int, required: int) -> None:
    """Print one calibration progress line, e.g. ``Baseline: 7/30 valid samples``."""
    print(f"[cv] Baseline: {collected}/{required} valid samples", flush=True)


def forward_rule_event(client: EventClient, event: str, session_id: str) -> None:
    """Forward one rule event to the backend.

    A backend/network failure is logged to stderr and swallowed so a transient
    outage never crashes the capture loop (M3.1 reliability requirement).
    """
    try:
        client.send_event(event, session_id)
        print(f"[cv] event sent: {event}", flush=True)
    except EventClientError as err:
        print(
            f"[cv] failed to forward event '{event}': {err}",
            file=sys.stderr,
            flush=True,
        )


def capture_baseline_for_rule(
    camera: Camera,
    detector: PoseDetector,
    min_samples: int,
    max_seconds: float,
    preview: PreviewRenderer | None = None,
) -> PostureBaseline:
    """Capture the upright baseline so ``run()`` can build the slouch rule.

    Computes the per-session baseline from live frames (M2.2). The baseline
    itself is not an event type the backend accepts, so nothing is posted here;
    the caller sees the failure reason when the baseline cannot be captured.

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
) -> str:
    """Open the camera, resolve a session, and capture until stopped.

    When ``detector`` is provided, the session baseline feeds an M2.3
    ``SlouchRule``: each monitoring frame updates the rule, and when a violation
    or recovery has been sustained for its configured duration the event is
    forwarded to the backend via ``POST /api/events`` (M3.1). A failed forward
    is logged and the loop continues; it never crashes the service.

    When ``preview_enabled`` is True, a development-only preview window shows
    the webcam feed with detected landmarks and calibration progress while the
    baseline is being captured.

    ``time_fn`` provides the monotonic clock used by the slouch rule (injectable
    for deterministic tests).
    """
    preview = PreviewRenderer() if preview_enabled else None
    session_id = ""
    rule: SlouchRule | None = None
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

        if detector is not None:
            detector.initialize()
            baseline = capture_baseline_for_rule(
                camera,
                detector,
                baseline_min_samples,
                baseline_max_seconds,
                preview=preview,
            )
            rule = SlouchRule(
                baseline.to_measurement(),
                slouch_threshold=config.slouch_threshold,
                slouch_duration_seconds=config.slouch_duration_seconds,
                correction_duration_seconds=config.correction_duration_seconds,
            )
            print(
                f"[cv] monitoring: threshold={config.slouch_threshold:.2f}, "
                f"slouch_duration={config.slouch_duration_seconds:.1f}s, "
                f"correction_duration={config.correction_duration_seconds:.1f}s",
                flush=True,
            )
        else:
            print(f"[cv] no pose detector; monitoring disabled for session {session_id}", flush=True)

        frames = 0
        while max_frames is None or frames < max_frames:
            frame = camera.read()
            if rule is not None:
                landmarks = detector.detect(frame)
                measurement = (
                    extract_posture_measurement(landmarks) if landmarks is not None else None
                )
                for event in rule.update(measurement, time_fn()):
                    forward_rule_event(client, event, session_id)
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
        description="PostureGuard computer vision service (M2.3: slouch rules).",
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
        default=5.0,
        help="baseline capture timeout in seconds (default: 5.0)",
    )
    args = parser.parse_args()

    config = Config.from_env()
    client = EventClient(config.backend_url)
    camera = Camera(config.camera_index)
    detector = PoseDetector()

    def _on_signal(_signum: int, _frame: Any) -> None:
        raise _StopRequested()

    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    try:
        run(
            config,
            client,
            camera,
            detector=detector,
            baseline_min_samples=args.min_samples,
            baseline_max_seconds=args.max_seconds,
            preview_enabled=not args.no_preview,
        )
    except _StopRequested:
        pass
    except CameraError as err:
        print(f"[cv] camera error: {err}", file=sys.stderr, flush=True)
        return 1
    except EventClientError as err:
        print(f"[cv] backend error: {err}", file=sys.stderr, flush=True)
        return 2
    except (BaselineCaptureError, PoseDetectionError) as err:
        print(f"[cv] baseline/vision error: {err}", file=sys.stderr, flush=True)
        return 3
    except KeyError as err:
        print(f"[cv] backend error: missing key {err}", file=sys.stderr, flush=True)
        return 2
    finally:
        detector.close()
        camera.release()

    print(f"[cv] postureguard-cv {__version__} stopped cleanly", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())