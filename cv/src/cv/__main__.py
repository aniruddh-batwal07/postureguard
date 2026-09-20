"""PostureGuard continuous Windows background CV daemon entry point (M2 redesign)."""

from __future__ import annotations

import argparse
import signal
import sys
from typing import Any

from cv import __version__
from cv.camera import Camera, CameraError
from cv.config import Config
from cv.daemon import CvDaemon
from cv.debug import PreviewRenderer
from cv.events import EventClient, EventClientError
from cv.pose import BaselineCaptureError, PoseDetectionError, PoseDetector
from cv.settings import CvSettings, SettingsPoller


EVENT_BASELINE_CAPTURED = "baseline_captured"


class _StopRequested(Exception):
    pass


def resolve_active_session(client: EventClient) -> dict[str, Any]:
    session = client.request("GET", "/api/sessions/active").get("session")
    if session is None:
        session = client.request("POST", "/api/sessions")["session"]
    return session


class DummyDetector:
    def initialize(self) -> None:
        pass

    def detect(self, frame: Any) -> Any:
        return None

    def close(self) -> None:
        pass


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
    time_fn: Any = None,
    settings_poller: Any | None = None,
) -> str:
    import time

    if time_fn is None:
        time_fn = time.monotonic

    if settings_poller is None:
        initial_settings = CvSettings(
            slouchThreshold=config.slouch_threshold,
            slouchDurationSeconds=config.slouch_duration_seconds,
            correctionDurationSeconds=config.correction_duration_seconds,
        )
        settings_poller = SettingsPoller(client, initial_settings=initial_settings)

    settings_poller.poll()


    preview = PreviewRenderer() if preview_enabled else None
    det = detector if detector is not None else DummyDetector()


    daemon = CvDaemon(
        config=config,
        client=client,
        camera=camera,
        detector=det,
        settings_poller=settings_poller,
        preview=preview,
        poll_interval=0.0,
        baseline_min_samples=baseline_min_samples,
        baseline_max_seconds=baseline_max_seconds,
        frame_delay=frame_delay,
        time_fn=time_fn,
    )


    try:
        try:
            camera.open()
            camera.read()
        except Exception:
            if preview is not None:
                preview.close()
            raise

        session = resolve_active_session(client)
        sid = str(session["id"])

        if detector is not None:
            detector.initialize()
            daemon.session_id = sid
            daemon.baseline_state = "capturing"
            daemon.state = "CAPTURING_BASELINE"
            daemon.run_baseline_capture()

            if daemon.baseline is None:
                raise BaselineCaptureError(
                    f"collected only 0/{baseline_min_samples} valid samples within {baseline_max_seconds}s"
                )

        daemon.session_id = sid
        daemon.run_loop(max_iterations=max_frames)
        return sid
    finally:
        daemon.close()



def main() -> int:
    parser = argparse.ArgumentParser(
        prog="postureguard-cv",
        description="PostureGuard continuous Windows background CV daemon.",
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
        help="valid upper-body samples required for baseline (default: 30)",
    )
    parser.add_argument(
        "--max-seconds",
        type=float,
        default=5.0,
        help="baseline capture timeout in seconds (default: 5.0)",
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=None,
        help="active session backend polling interval in seconds (default: 1.0)",
    )
    args = parser.parse_args()

    config = Config.from_env()
    poll_interval = args.poll_interval if args.poll_interval is not None else config.poll_interval

    client = EventClient(config.backend_url)
    camera = Camera(config.camera_index)
    detector = PoseDetector()

    initial_settings = CvSettings(
        slouchThreshold=config.slouch_threshold,
        slouchDurationSeconds=config.slouch_duration_seconds,
        correctionDurationSeconds=config.correction_duration_seconds,
    )
    settings_poller = SettingsPoller(client, initial_settings=initial_settings)
    preview = PreviewRenderer() if not args.no_preview else None

    daemon = CvDaemon(
        config=config,
        client=client,
        camera=camera,
        detector=detector,
        settings_poller=settings_poller,
        preview=preview,
        poll_interval=poll_interval,
        baseline_min_samples=args.min_samples,
        baseline_max_seconds=args.max_seconds,
    )

    def _on_signal(_signum: int, _frame: Any) -> None:
        raise _StopRequested()

    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    print(f"[cv] postureguard-cv {__version__} starting continuous daemon", flush=True)

    try:
        daemon.run_loop()
    except _StopRequested:
        print("[cv] shutdown requested", flush=True)
    except CameraError as err:
        print(f"[cv] camera error: {err}", file=sys.stderr, flush=True)
        return 1
    except EventClientError as err:
        print(f"[cv] backend error: {err}", file=sys.stderr, flush=True)
        return 2
    except (BaselineCaptureError, PoseDetectionError) as err:
        print(f"[cv] vision error: {err}", file=sys.stderr, flush=True)
        return 3
    finally:
        daemon.close()

    print(f"[cv] postureguard-cv {__version__} stopped cleanly", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())