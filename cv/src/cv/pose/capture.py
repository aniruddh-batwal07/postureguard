"""Baseline capture orchestration: camera + pose detector → per-session baseline."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

from cv.camera import Camera, CameraError
from cv.pose.baseline import BaselineCollector, BaselineError, PostureBaseline
from cv.pose.detector import PoseDetector
from cv.pose.posture import extract_posture_measurement

# Progress callback: invoked with the number of valid samples collected and the
# number required (e.g. ``(7, 30)``) whenever the count changes, including once
# at the start with ``(0, required)``.
ProgressCallback = Callable[[int, int], None]


class BaselineCaptureError(RuntimeError):
    """Raised when baseline capture fails (camera error or timeout)."""


def capture_baseline(
    camera: Camera,
    detector: PoseDetector,
    min_samples: int = 30,
    max_seconds: float = 5.0,
    frame_delay: float = 0.05,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.perf_counter,
    progress: ProgressCallback | None = None,
    preview: Any | None = None,
) -> PostureBaseline:
    """Capture a baseline from the user's upright posture.

    Runs the pose detector over live camera frames, collects valid posture
    measurements, and once ``min_samples`` are gathered returns the baseline.
    A sample is valid when the required upper-body landmarks (nose + both
    shoulders) meet the detector's visibility requirement — hips are never
    required.

    The loop is bounded by ``max_seconds`` and never waits indefinitely. When
    the count of collected samples changes, ``progress(collected, min_samples)``
    is invoked so the caller can show calibration progress. Invalid frames are
    skipped normally; progress reporting and the optional ``preview`` renderer
    keep the calibration loop visibly active.

    Args:
        camera: opened camera.
        detector: initialized pose detector.
        min_samples: number of valid measurements required for the baseline.
        max_seconds: upper bound on capture time before giving up.
        frame_delay: delay between frames (seconds).
        sleep: sleep function (injected for tests).
        clock: monotonic clock function (injected for deterministic tests).
        progress: optional callback invoked with ``(collected, required)``
            whenever the collected count changes (called once with ``(0,
            required)`` at the start).
        preview: optional development-only preview renderer (see
            ``cv.debug.PreviewRenderer``) rendered against each captured frame.

    Returns:
        PostureBaseline computed from the collected upright samples.

    Raises:
        BaselineCaptureError: camera read fails, or the baseline is not ready
            before the timeout (e.g. the user's upper body was not visible).
            The message includes a clear reason: the timeout, the expected
            number of samples, and how many were actually collected.
    """
    collector = BaselineCollector(min_samples=min_samples)
    start = clock()
    last_count = 0
    if progress is not None:
        progress(0, min_samples)

    def _ready_sample_count() -> None:
        nonlocal last_count
        if collector.sample_count != last_count:
            last_count = collector.sample_count
            if progress is not None:
                progress(last_count, min_samples)

    while not collector.is_ready:
        if clock() - start > max_seconds:
            raise BaselineCaptureError(
                f"baseline failed: collected only "
                f"{collector.sample_count}/{min_samples} valid samples within "
                f"{max_seconds:.1f}s ({min_samples - collector.sample_count} more "
                f"required); make sure your upper body (head and shoulders) "
                f"is visible to the camera"
            )

        try:
            frame = camera.read()
        except CameraError as err:
            raise BaselineCaptureError(f"baseline failed: camera read error: {err}") from err

        landmarks = detector.detect(frame)
        if landmarks is not None and landmarks.is_valid:
            measurement = extract_posture_measurement(landmarks)
            collector.add_measurement(measurement)

        if preview is not None and preview.enabled:
            preview.render(
                frame,
                landmarks=landmarks,
                status=f"Baseline: {collector.sample_count}/{min_samples} valid samples",
            )

        if frame_delay > 0:
            sleep(frame_delay)

        _ready_sample_count()

    return collector.compute()


def baseline_capture_payload(baseline: PostureBaseline) -> dict:
    """Build the data payload for the ``baseline_captured`` event.

    Includes the baseline reference values the backend evaluates deviation
    measurements against (see product-spec §7 step 1).
    """
    return {
        "baseline": baseline.to_dict(),
    }