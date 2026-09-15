"""PostureGuard CV service entry point (M2.1: camera + events; M2.2: pose baseline)."""

from __future__ import annotations

import argparse
import signal
import sys
import time
from typing import Any

from cv import __version__
from cv.camera import Camera, CameraError
from cv.config import Config
from cv.debug import PreviewRenderer
from cv.events import EventClient, EventClientError
from cv.pose import (
    BaselineCaptureError,
    PoseDetectionError,
    PoseDetector,
    baseline_capture_payload,
    capture_baseline,
)


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


def capture_baseline_event(
    client: EventClient,
    session_id: str,
    camera: Camera,
    detector: PoseDetector,
    min_samples: int,
    max_seconds: float,
    preview: PreviewRenderer | None = None,
) -> None:
    """Capture the upright baseline and emit ``baseline_captured``.

    Computes the per-session baseline from live frames and posts the event with
    the baseline deviation measurements (M2.2). Never emits the event when the
    baseline cannot be captured — the caller sees the failure reason.
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
        client.send_event(
            "baseline_captured", session_id, data=baseline_capture_payload(baseline)
        )
        print(
            f"[cv] baseline captured from {baseline.sample_count} samples: "
            f"head_forward={baseline.head_forward:.2f} "
            f"head_drop={baseline.head_drop:.2f} "
            f"shoulder_roll={baseline.shoulder_roll:.2f}",
            flush=True,
        )
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
) -> str:
    """Open the camera, post the initial events, and capture until stopped.

    When ``detector`` is provided, the ``baseline_captured`` event carries the
    real upright-posture baseline (M2.2). Without a detector, a placeholder
    ``baseline_captured`` is emitted (M2.1 behavior).

    When ``preview_enabled`` is True, a development-only preview window shows
    the webcam feed with detected landmarks and calibration progress while the
    baseline is being captured.
    """
    preview = PreviewRenderer() if preview_enabled else None
    session_id = ""
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
        client.send_event("session_start", session_id)

        if detector is not None:
            detector.initialize()
            capture_baseline_event(
                client,
                session_id,
                camera,
                detector,
                baseline_min_samples,
                baseline_max_seconds,
                preview=preview,
            )
        else:
            client.send_event("baseline_captured", session_id)
            print(f"[cv] sent session_start + baseline_captured for session {session_id}", flush=True)

        frames = 0
        while max_frames is None or frames < max_frames:
            camera.read()
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
        description="PostureGuard computer vision service (M2.2: pose baseline).",
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