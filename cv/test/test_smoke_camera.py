"""Real-camera MediaPipe Pose smoke test.

This test must be run on the Windows host with a physical webcam.
It is NOT designed for CI — it opens the real camera and runs MediaPipe.

Usage (Windows PowerShell, from the cv/ directory):

    & "C:\\Users\\<you>\\.venvs\\postureguard-cv\\Scripts\\python.exe" `
        -m pytest test/test_smoke_camera.py -m smoke -v -s

Requirements:
    - Physical webcam connected and capturing the user's upper body
      (head + shoulders must be visible in the frame; hips are NOT required
      because they are frequently below the frame on a laptop webcam)
    - MediaPipe + OpenCV installed in the Windows-side venv
    - The package must be installed as an editable install in the venv

Note: the camera needs ~0.5 s of warm-up after open() for auto-exposure to
settle.  The helper _warm_up_camera() drains frames to handle this.
"""

from __future__ import annotations

import time

import numpy as np
import pytest

from cv.camera import Camera, CameraError
from cv.pose import (
    BaselineCaptureError,
    PoseDetectionError,
    PoseDetector,
    capture_baseline,
)

# Number of frames to drain after camera.open() before starting pose detection.
_WARMUP_FRAMES = 10
_WARMUP_SLEEP = 0.05  # seconds between warm-up reads

_MIN_SAMPLES = 10
_TIMEOUT = 20.0  # seconds of real camera time


def _warm_up_camera(camera: Camera) -> None:
    """Drain frames so auto-exposure/white-balance settles."""
    for _ in range(_WARMUP_FRAMES):
        try:
            camera.read()
        except CameraError:
            break
        time.sleep(_WARMUP_SLEEP)


def _progress(collected: int, required: int) -> None:
    print(f"[smoke] Baseline: {collected}/{required} valid samples", flush=True)


@pytest.mark.smoke
class TestRealCameraMediaPipe:
    """Smoke test: real camera → MediaPipe Pose → valid upper-body landmarks → baseline."""

    def test_camera_opens_and_captures_frame(self):
        """Verify the webcam opens and returns a valid frame."""
        camera = Camera(0)
        try:
            camera.open()
            frame = camera.read()
            assert frame is not None
            assert len(frame.shape) == 3  # H, W, C
            assert frame.shape[2] == 3    # BGR
            assert frame.shape[0] > 0 and frame.shape[1] > 0
        finally:
            camera.release()

    def test_mediapipe_pose_detects_upper_body_landmarks(self):
        """Verify MediaPipe Pose returns a valid sample from a real frame.

        A valid sample only needs the nose and both shoulders visible — hips
        are not required (they are often below the frame on a laptop webcam).
        """
        camera = Camera(0)
        detector = PoseDetector(min_detection_confidence=0.5)
        try:
            camera.open()
            detector.initialize()
            _warm_up_camera(camera)

            start = time.time()
            landmarks = None
            while (time.time() - start) < _TIMEOUT:
                frame = camera.read()
                landmarks = detector.detect(frame)
                if landmarks is not None and landmarks.is_valid:
                    break
                time.sleep(0.1)

            assert landmarks is not None, (
                f"No pose detected in {_TIMEOUT:.0f}s — ensure your head and "
                f"shoulders are visible in the camera frame"
            )
            assert landmarks.is_valid, (
                f"Pose detected but missing required upper-body landmarks "
                f"(need NOSE and both SHOULDERS visible): "
                f"{list(landmarks.landmarks.keys())}"
            )
            assert landmarks.image_width > 0
            assert landmarks.image_height > 0
            for required in ("NOSE", "LEFT_SHOULDER", "RIGHT_SHOULDER"):
                assert required in landmarks.landmarks
        finally:
            detector.close()
            camera.release()

    def test_baseline_capture_flow(self):
        """Verify the full baseline flow: camera → pose → valid samples → baseline."""
        camera = Camera(0)
        detector = PoseDetector(min_detection_confidence=0.5)
        try:
            camera.open()
            detector.initialize()
            _warm_up_camera(camera)

            baseline = capture_baseline(
                camera,
                detector,
                min_samples=_MIN_SAMPLES,
                max_seconds=_TIMEOUT,
                progress=_progress,
            )
            assert baseline.sample_count >= _MIN_SAMPLES
            assert np.isfinite(baseline.head_forward)
            assert np.isfinite(baseline.head_drop)
            assert np.isfinite(baseline.shoulder_roll)
            print(
                f"[smoke] baseline OK: {baseline.sample_count} samples, "
                f"head_forward={baseline.head_forward:.3f}, "
                f"head_drop={baseline.head_drop:.3f}, "
                f"shoulder_roll={baseline.shoulder_roll:.3f}",
                flush=True,
            )
        finally:
            detector.close()
            camera.release()

    def test_deviation_calculation_after_baseline(self):
        """Verify deviation can be computed against the captured baseline."""
        from cv.pose import calculate_deviation, extract_posture_measurement

        camera = Camera(0)
        detector = PoseDetector(min_detection_confidence=0.5)
        try:
            camera.open()
            detector.initialize()
            _warm_up_camera(camera)

            try:
                baseline = capture_baseline(
                    camera,
                    detector,
                    min_samples=3,
                    max_seconds=_TIMEOUT,
                )
            except BaselineCaptureError:
                pytest.skip("could not collect a baseline — upper body not visible")

            # Grab one live measurement (may match the baseline; that's fine).
            start = time.time()
            deviation = None
            while (time.time() - start) < _TIMEOUT:
                frame = camera.read()
                landmarks = detector.detect(frame)
                if landmarks is not None and landmarks.is_valid:
                    current = extract_posture_measurement(landmarks)
                    if current is not None:
                        deviation = calculate_deviation(
                            current, baseline.to_measurement()
                        )
                        break
                time.sleep(0.05)

            assert deviation is not None, "no live measurement available"
            assert deviation.magnitude() >= 0
            assert isinstance(deviation.to_dict(), dict)
        finally:
            detector.close()
            camera.release()