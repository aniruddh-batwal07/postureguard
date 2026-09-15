"""Unit tests for the pose detection module with synthetic landmarks."""

from __future__ import annotations

import math

import numpy as np
import pytest

from cv.pose.baseline import BaselineCollector, BaselineError, PostureBaseline, compute_baseline
from cv.pose.detector import (
    REQUIRED_LANDMARKS,
    PoseDetectionError,
    PoseDetector,
    PoseLandmarks,
)
from cv.pose.posture import (
    PostureDeviation,
    PostureMeasurement,
    calculate_deviation,
    extract_posture_measurement,
)


# ---------------------------------------------------------------------------
# Synthetic pose landmarks helpers
# ---------------------------------------------------------------------------

def _make_landmarks(
    nose: tuple[float, float, float] = (0.5, 0.28, 0.0),
    left_shoulder: tuple[float, float, float] = (0.42, 0.45, 0.0),
    right_shoulder: tuple[float, float, float] = (0.58, 0.45, 0.0),
    left_hip: tuple[float, float, float] | None = (0.43, 0.78, 0.0),
    right_hip: tuple[float, float, float] | None = (0.57, 0.78, 0.0),
    visible: float = 0.9,
) -> PoseLandmarks:
    """Create synthetic PoseLandmarks for a neutral upright posture.

    Hips are optional (default: present but unused) so tests can explicitly
    exercise the "hips missing is still valid" rule of a laptop webcam setup.
    """
    landmarks = {
        "NOSE": nose,
        "LEFT_SHOULDER": left_shoulder,
        "RIGHT_SHOULDER": right_shoulder,
    }
    if left_hip is not None:
        landmarks["LEFT_HIP"] = left_hip
    if right_hip is not None:
        landmarks["RIGHT_HIP"] = right_hip
    visibility = {name: visible for name in landmarks}
    return PoseLandmarks(
        landmarks=landmarks,
        visibility=visibility,
        image_width=640,
        image_height=480,
    )


def _without(landmarks: PoseLandmarks, *names: str) -> PoseLandmarks:
    """Return a copy of landmarks with the named landmarks removed."""
    return PoseLandmarks(
        landmarks={k: v for k, v in landmarks.landmarks.items() if k not in names},
        visibility={k: v for k, v in landmarks.visibility.items() if k not in names},
        image_width=landmarks.image_width,
        image_height=landmarks.image_height,
    )


def _upper_only() -> PoseLandmarks:
    """Neutral upright posture using ONLY the required upper-body landmarks."""
    return _make_landmarks(left_hip=None, right_hip=None)


def _measurement(head_forward=0.0, head_drop=0.0, shoulder_roll=0.0) -> PostureMeasurement:
    return PostureMeasurement(
        head_forward=head_forward,
        head_drop=head_drop,
        shoulder_roll=shoulder_roll,
    )


# ---------------------------------------------------------------------------
# Tests: REQUIRED_LANDMARKS / PoseLandmarks validity
# ---------------------------------------------------------------------------

class TestPoseLandmarks:
    def test_required_set_is_upper_body_only(self):
        assert set(REQUIRED_LANDMARKS) == {"NOSE", "LEFT_SHOULDER", "RIGHT_SHOULDER"}
        assert "LEFT_HIP" not in REQUIRED_LANDMARKS
        assert "RIGHT_HIP" not in REQUIRED_LANDMARKS

    def test_is_valid_with_all_required_upper_body_landmarks(self):
        assert _upper_only().is_valid is True

    def test_is_valid_when_hips_are_missing(self):
        lm = _without(_make_landmarks(), "LEFT_HIP", "RIGHT_HIP")
        assert lm.is_valid is True

    def test_is_valid_when_hips_are_present(self):
        lm = _make_landmarks()
        assert lm.is_valid is True

    def test_is_valid_missing_nose(self):
        assert _without(_upper_only(), "NOSE").is_valid is False

    def test_is_valid_missing_left_shoulder(self):
        assert _without(_upper_only(), "LEFT_SHOULDER").is_valid is False

    def test_is_valid_missing_right_shoulder(self):
        assert _without(_upper_only(), "RIGHT_SHOULDER").is_valid is False

    def test_empty_landmarks_not_valid(self):
        lm = PoseLandmarks(
            landmarks={}, visibility={}, image_width=640, image_height=480
        )
        assert lm.is_valid is False

    def test_non_finite_required_landmark_is_not_valid(self):
        lm = _make_landmarks(nose=(math.nan, 0.28, 0.0))
        assert lm.is_valid is False


# ---------------------------------------------------------------------------
# Tests: PostureMeasurement extraction (upper body only)
# ---------------------------------------------------------------------------

class TestExtractPostureMeasurement:
    def test_upright_posture_extracted_without_hips(self):
        measurement = extract_posture_measurement(_upper_only())
        assert measurement is not None
        assert isinstance(measurement, PostureMeasurement)
        # Upright centered user: nose roughly above the shoulder midpoint.
        assert abs(measurement.head_forward) < 0.25
        assert measurement.head_drop < 0.0  # nose above the shoulder line

    def test_invalid_landmarks_returns_none(self):
        lm = PoseLandmarks(
            landmarks={"NOSE": (0.5, 0.3, 0.0)},
            visibility={"NOSE": 0.9},
            image_width=640,
            image_height=480,
        )
        assert extract_posture_measurement(lm) is None

    def test_slouched_vs_upright_different(self):
        upright_m = extract_posture_measurement(_upper_only())
        slouched_landmarks = _make_landmarks(
            nose=(0.58, 0.52, 0.0),   # head forward and dropped toward shoulders
            left_shoulder=(0.42, 0.45, 0.0),
            right_shoulder=(0.58, 0.45, 0.0),
            left_hip=None,
            right_hip=None,
        )
        slouched_m = extract_posture_measurement(slouched_landmarks)
        assert upright_m is not None
        assert slouched_m is not None
        assert slouched_m.head_forward != upright_m.head_forward
        assert slouched_m.head_drop > upright_m.head_drop

    def test_measurement_to_dict(self):
        m = extract_posture_measurement(_upper_only())
        d = m.to_dict()
        assert {"head_forward", "head_drop", "shoulder_roll"} <= set(d)

    def test_degenerate_zero_shoulder_width_returns_none(self):
        lm = _make_landmarks(
            left_shoulder=(0.5, 0.45, 0.0),
            right_shoulder=(0.5, 0.45, 0.0),
            left_hip=None,
            right_hip=None,
        )
        assert extract_posture_measurement(lm) is None


# ---------------------------------------------------------------------------
# Tests: PostureDeviation
# ---------------------------------------------------------------------------

class TestCalculateDeviation:
    def test_same_posture_zero_deviation(self):
        m = _measurement(head_forward=0.05, head_drop=-0.4, shoulder_roll=0.01)
        assert calculate_deviation(m, m).magnitude() == pytest.approx(0.0)

    def test_deviation_values_correct(self):
        baseline = _measurement(head_forward=0.0, head_drop=-0.4, shoulder_roll=0.0)
        current = _measurement(head_forward=0.15, head_drop=-0.1, shoulder_roll=0.05)
        dev = calculate_deviation(current, baseline)
        assert dev.head_forward_diff == pytest.approx(0.15)
        assert dev.head_drop_diff == pytest.approx(0.3)
        assert dev.shoulder_roll_diff == pytest.approx(0.05)
        assert dev.magnitude() > 0

    def test_deviation_to_dict(self):
        baseline = _measurement(head_forward=0.0, head_drop=-0.4, shoulder_roll=0.0)
        current = _measurement(head_forward=0.15, head_drop=-0.1, shoulder_roll=0.0)
        d = calculate_deviation(current, baseline).to_dict()
        assert {"head_forward_diff", "head_drop_diff", "shoulder_roll_diff", "magnitude"} <= set(d)


# ---------------------------------------------------------------------------
# Tests: Baseline computation
# ---------------------------------------------------------------------------

class TestComputeBaseline:
    def test_single_measurement(self):
        baseline = compute_baseline([_measurement(head_drop=-0.4)])
        assert baseline.head_drop == -0.4
        assert baseline.sample_count == 1

    def test_average_of_measurements(self):
        m1 = _measurement(head_forward=0.1)
        m2 = _measurement(head_forward=0.3)
        baseline = compute_baseline([m1, m2])
        assert baseline.head_forward == pytest.approx(0.2)
        assert baseline.sample_count == 2

    def test_empty_raises(self):
        with pytest.raises(BaselineError):
            compute_baseline([])

    def test_baseline_to_measurement(self):
        baseline = compute_baseline([_measurement(head_drop=-0.4)])
        as_measurement = baseline.to_measurement()
        assert as_measurement.head_drop == -0.4

    def test_baseline_to_dict(self):
        baseline = compute_baseline([_measurement()])
        d = baseline.to_dict()
        assert d["sample_count"] == 1
        assert "head_forward" in d


# ---------------------------------------------------------------------------
# Tests: BaselineCollector
# ---------------------------------------------------------------------------

class TestBaselineCollector:
    def test_collects_until_ready(self):
        collector = BaselineCollector(min_samples=3)
        assert collector.is_ready is False
        assert collector.add_measurement(_measurement()) is False
        assert collector.add_measurement(_measurement()) is False
        assert collector.add_measurement(_measurement()) is True
        assert collector.is_ready is True
        assert collector.sample_count == 3

    def test_ignores_none_measurements(self):
        collector = BaselineCollector(min_samples=2)
        collector.add_measurement(None)
        collector.add_measurement(_measurement())
        assert collector.sample_count == 1
        assert collector.is_ready is False

    def test_compute_requires_min_samples(self):
        collector = BaselineCollector(min_samples=3)
        collector.add_measurement(_measurement())
        collector.add_measurement(_measurement())
        with pytest.raises(BaselineError, match="need 3"):
            collector.compute()

    def test_compute_works_when_ready(self):
        collector = BaselineCollector(min_samples=2)
        collector.add_measurement(_measurement(head_forward=0.1))
        collector.add_measurement(_measurement(head_forward=0.3))
        baseline = collector.compute()
        assert baseline.head_forward == pytest.approx(0.2)

    def test_invalid_min_samples(self):
        with pytest.raises(ValueError):
            BaselineCollector(min_samples=0)

    def test_ignores_non_finite_measurements(self):
        collector = BaselineCollector(min_samples=1)
        invalid = _measurement(head_forward=math.nan)
        assert collector.add_measurement(invalid) is False
        assert collector.sample_count == 0

    def test_compute_rejects_non_finite_measurements(self):
        invalid = _measurement(head_forward=math.nan)
        with pytest.raises(BaselineError, match="invalid measurements"):
            compute_baseline([invalid])


# ---------------------------------------------------------------------------
# Tests: PoseDetector landmark filtering
# ---------------------------------------------------------------------------

class _FakeLandmark:
    def __init__(self, x, y, z, visibility):
        self.x = x
        self.y = y
        self.z = z
        self.visibility = visibility


def _fake_pose_landmarks():
    """33-entry fake MediaPipe landmark list for a neutral upper body.

    Shoulders and nose are highly visible; hips/elbows are present but with
    low visibility (out of frame / occluded), mirroring a laptop webcam.
    """
    entries = [_FakeLandmark(0.0, 0.0, 0.0, 0.0) for _ in range(33)]
    entries[0] = _FakeLandmark(0.5, 0.28, 0.0, 0.95)   # NOSE
    entries[11] = _FakeLandmark(0.42, 0.45, 0.0, 0.95)  # LEFT_SHOULDER
    entries[12] = _FakeLandmark(0.58, 0.45, 0.0, 0.95)  # RIGHT_SHOULDER
    entries[14] = _FakeLandmark(0.70, 0.55, 0.0, 0.45)  # RIGHT_ELBOW (low vis)
    entries[23] = _FakeLandmark(0.43, 0.78, 0.0, 0.30)  # LEFT_HIP (low vis)
    entries[24] = _FakeLandmark(0.57, 0.78, 0.0, 0.30)  # RIGHT_HIP (low vis)
    return entries


class TestPoseDetector:
    def test_not_initialized_raises(self):
        detector = PoseDetector()
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        with pytest.raises(PoseDetectionError, match="not initialized"):
            detector.detect(frame)

    def test_none_frame_returns_none(self):
        detector = PoseDetector()
        detector._landmarker = object()  # fake initialized
        assert detector.detect(None) is None

    def test_empty_frame_returns_none(self):
        detector = PoseDetector()
        detector._landmarker = object()
        assert detector.detect(np.array([], dtype=np.uint8)) is None

    def test_default_threshold_drops_low_visibility_landmarks(self):
        detector = PoseDetector()  # default visibility threshold 0.5
        landmarks = detector._extract_landmarks(_fake_pose_landmarks(), 640, 480)
        # Only the highly visible upper-body landmarks survive the filter.
        assert set(landmarks.landmarks) == {"NOSE", "LEFT_SHOULDER", "RIGHT_SHOULDER"}
        assert landmarks.is_valid is True  # hips absent -> still valid

    def test_configured_threshold_is_used(self):
        detector = PoseDetector(landmark_visibility_threshold=0.97)
        landmarks = detector._extract_landmarks(_fake_pose_landmarks(), 640, 480)
        assert landmarks.landmarks == {}  # nothing met the stricter threshold

    def test_landmark_visibility_threshold_exposed(self):
        detector = PoseDetector(landmark_visibility_threshold=0.8)
        assert detector.landmark_visibility_threshold == 0.8

    def test_context_manager(self):
        detector = PoseDetector()
        try:
            with detector:
                assert detector._landmarker is not None
            assert detector._landmarker is None
        except PoseDetectionError:
            # mediapipe not installed in this env
            pass


# ---------------------------------------------------------------------------
# Tests: Full pipeline - synthetic frames
# ---------------------------------------------------------------------------

class TestPosturePipeline:
    def test_baseline_then_deviation_with_upper_body_only(self):
        # Simulate: collect baseline from upright upper-body measurements.
        collector = BaselineCollector(min_samples=3)
        upright_m = _measurement(head_forward=0.0, head_drop=-0.4, shoulder_roll=0.0)
        for _ in range(3):
            collector.add_measurement(upright_m)

        baseline = collector.compute()

        # Now simulate a slouched posture (head forward and dropped).
        slouched_m = _measurement(head_forward=0.2, head_drop=0.1, shoulder_roll=0.05)
        deviation = calculate_deviation(slouched_m, baseline.to_measurement())

        assert deviation.head_drop_diff == pytest.approx(0.5)
        assert deviation.magnitude() > 0.1  # clearly different posture