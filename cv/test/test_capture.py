"""Unit tests for baseline capture orchestration (cv/pose/capture.py)."""

from __future__ import annotations

import numpy as np
import pytest

from cv.camera import CameraError
from cv.pose import (
    BaselineCaptureError,
    PoseLandmarks,
    PostureBaseline,
    baseline_capture_payload,
    capture_baseline,
)
from cv.pose.capture import baseline_capture_payload as _payload


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------

def _upper_body_landmarks() -> PoseLandmarks:
    """Valid landmarks for a laptop webcam: NO hips (they are out of frame)."""
    return PoseLandmarks(
        landmarks={
            "NOSE": (0.5, 0.3, 0.0),
            "LEFT_SHOULDER": (0.4, 0.5, 0.0),
            "RIGHT_SHOULDER": (0.6, 0.5, 0.0),
        },
        visibility={"NOSE": 0.9, "LEFT_SHOULDER": 0.9, "RIGHT_SHOULDER": 0.9},
        image_width=640,
        image_height=480,
    )


def _upright_landmarks() -> PoseLandmarks:
    """Valid landmarks that also happen to include hips."""
    return PoseLandmarks(
        landmarks={
            "NOSE": (0.5, 0.3, 0.0),
            "LEFT_SHOULDER": (0.4, 0.5, 0.0),
            "RIGHT_SHOULDER": (0.6, 0.5, 0.0),
            "LEFT_HIP": (0.42, 0.8, 0.0),
            "RIGHT_HIP": (0.58, 0.8, 0.0),
        },
        visibility={"NOSE": 0.9, "LEFT_SHOULDER": 0.9, "RIGHT_SHOULDER": 0.9,
                     "LEFT_HIP": 0.9, "RIGHT_HIP": 0.9},
        image_width=640,
        image_height=480,
    )


class FakeDetector:
    """Detector that returns predefined landmark results in a cycle."""

    def __init__(self, results):
        self._results = list(results)
        self._idx = 0
        self.initialize_calls = 0

    def initialize(self):
        self.initialize_calls += 1

    def detect(self, frame):
        result = self._results[self._idx % len(self._results)]
        self._idx += 1
        return result

    def close(self):
        pass


def _frame():
    return np.zeros((480, 640, 3), dtype=np.uint8)


class FakeCamera:
    def __init__(self, frame=None, fail_read=False):
        self._frame = frame if frame is not None else _frame()
        self.fail_read = fail_read
        self.reads = 0

    def read(self):
        self.reads += 1
        if self.fail_read:
            raise CameraError("read failed")
        return self._frame


def _noop_sleep(_seconds):
    pass


class FakeClock:
    """Injectable clock that advances a fixed step on every call."""

    def __init__(self, interval: float = 0.1):
        self.t = 0.0
        self.interval = interval

    def __call__(self) -> float:
        self.t += self.interval
        return self.t


class RecordingProgress:
    def __init__(self):
        self.calls = []

    def __call__(self, collected, required):
        self.calls.append((collected, required))


# ---------------------------------------------------------------------------
# Tests: capture_baseline
# ---------------------------------------------------------------------------

class TestCaptureBaseline:
    def test_captures_baseline_from_upper_body_only_landmarks(self):
        camera = FakeCamera()
        detector = FakeDetector([_upper_body_landmarks()])
        baseline = capture_baseline(
            camera, detector, min_samples=3, max_seconds=5.0,
            frame_delay=0.0, sleep=_noop_sleep,
        )
        assert baseline.sample_count == 3
        assert detector.initialize_calls == 0  # capture_baseline doesn't init the detector

    def test_missing_hips_do_not_invalidate_samples(self):
        # A laptop webcam rarely sees the hips: samples must stay valid.
        camera = FakeCamera()
        detector = FakeDetector([_upper_body_landmarks(), _upright_landmarks()])
        baseline = capture_baseline(
            camera, detector, min_samples=4, max_seconds=5.0,
            frame_delay=0.0, sleep=_noop_sleep,
        )
        assert baseline.sample_count == 4

    def test_ignores_invalid_landmarks_continues_capture(self):
        # First result invalid/None, then valid upper-body landmarks.
        camera = FakeCamera()
        detector = FakeDetector([None, _upper_body_landmarks()])
        baseline = capture_baseline(
            camera, detector, min_samples=2, max_seconds=5.0,
            frame_delay=0.0, sleep=_noop_sleep,
        )
        assert baseline.sample_count == 2

    def test_times_out_when_insufficient_valid_samples(self):
        camera = FakeCamera()
        detector = FakeDetector([None])
        with pytest.raises(BaselineCaptureError) as excinfo:
            capture_baseline(
                camera, detector, min_samples=3, max_seconds=5.0,
                frame_delay=0.0, sleep=_noop_sleep, clock=FakeClock(),
            )
        message = str(excinfo.value)
        assert "baseline failed" in message
        assert "0/3 valid samples" in message
        assert "3" in message  # the required count is included in the reason

    def test_times_out_deterministically_with_injected_clock(self):
        # No wall-clock dependence: a fixed-step clock makes the timeout exact.
        camera = FakeCamera()
        detector = FakeDetector([None])
        clock = FakeClock(interval=1.0)
        with pytest.raises(BaselineCaptureError, match="0/1 valid samples"):
            capture_baseline(
                camera, detector, min_samples=1, max_seconds=0.5,
                frame_delay=0.0, sleep=_noop_sleep, clock=clock,
            )

    def test_wraps_camera_read_error(self):
        camera = FakeCamera(fail_read=True)
        detector = FakeDetector([_upper_body_landmarks()])
        with pytest.raises(BaselineCaptureError, match="camera read error"):
            capture_baseline(
                camera, detector, min_samples=1, max_seconds=0.01,
                frame_delay=0.0, sleep=_noop_sleep,
            )
        assert camera.reads >= 1

    def test_reports_progress_as_samples_are_collected(self):
        camera = FakeCamera()
        detector = FakeDetector([_upper_body_landmarks()])
        progress = RecordingProgress()
        capture_baseline(
            camera, detector, min_samples=3, max_seconds=5.0,
            frame_delay=0.0, sleep=_noop_sleep, progress=progress,
        )
        assert progress.calls == [(0, 3), (1, 3), (2, 3), (3, 3)]

    def test_reports_progress_start_only_when_no_valid_samples(self):
        camera = FakeCamera()
        detector = FakeDetector([None])
        progress = RecordingProgress()
        with pytest.raises(BaselineCaptureError):
            capture_baseline(
                camera, detector, min_samples=5, max_seconds=0.0,
                frame_delay=0.0, sleep=_noop_sleep, clock=FakeClock(),
                progress=progress,
            )
        assert progress.calls == [(0, 5)]


# ---------------------------------------------------------------------------
# Tests: baseline_capture_payload
# ---------------------------------------------------------------------------

class TestBaselineCapturePayload:
    def test_payload_contains_baseline_dict(self):
        baseline = PostureBaseline(
            head_forward=0.0, head_drop=-0.4, shoulder_roll=0.0, sample_count=7,
        )
        payload = baseline_capture_payload(baseline)
        assert "baseline" in payload
        assert payload["baseline"]["head_drop"] == pytest.approx(-0.4)
        assert payload["baseline"]["sample_count"] == 7


# The module-level function `_payload` import guards against accidental name clashes.
def test_payload_alias_matches_export():
    assert _payload is baseline_capture_payload