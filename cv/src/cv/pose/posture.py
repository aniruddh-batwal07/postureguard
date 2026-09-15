"""Posture measurement representation and deviation calculation.

Only reliably visible upper-body landmarks (nose, left shoulder, right shoulder)
are used. The hips are intentionally excluded because with a typical laptop
webcam they are frequently below the camera frame and therefore cannot be
relied upon for a valid sample.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from cv.pose.detector import PoseLandmarks

# Upper-body landmark names used for posture measurement (see REQUIRED_LANDMARKS).
_NOSE = "NOSE"
_LEFT_SHOULDER = "LEFT_SHOULDER"
_RIGHT_SHOULDER = "RIGHT_SHOULDER"


@dataclass(frozen=True)
class PostureMeasurement:
    """Represents a single posture measurement extracted from pose landmarks.

    Only uses the nose and both shoulders. All features are normalized by the
    shoulder span in the image, so they are comparable across camera distance:

    - head_forward: horizontal offset of the nose from the shoulder midpoint
        (normalized by shoulder span). Positive = head ahead of the shoulders.
    - head_drop: vertical offset of the nose from the shoulder midpoint
        (normalized by shoulder span). Positive = nose below the shoulder
        line. Slouching (head drops toward / past the shoulders) increases it.
    - shoulder_roll: shoulder asymmetry (left minus right shoulder height,
        normalized by shoulder span). Positive = left shoulder lower in the
        image.

    This is a deliberately simple measurement: M2.3 slouch detection compares
    live measurements against the session baseline via ``PostureDeviation``.
    """

    head_forward: float
    head_drop: float
    shoulder_roll: float

    def to_dict(self) -> dict[str, float]:
        """Convert to dictionary for event serialization."""
        return {
            "head_forward": round(self.head_forward, 4),
            "head_drop": round(self.head_drop, 4),
            "shoulder_roll": round(self.shoulder_roll, 4),
        }


def extract_posture_measurement(landmarks: PoseLandmarks) -> PostureMeasurement | None:
    """Extract an upper-body posture measurement from pose landmarks.

    Args:
        landmarks: valid pose landmarks (``is_valid`` True).

    Returns:
        PostureMeasurement if the required landmarks are measurable, None if
        the landmarks are insufficient or degenerate.
    """
    if not landmarks.is_valid:
        return None

    try:
        nose = landmarks.landmarks[_NOSE][:2]
        left_shoulder = landmarks.landmarks[_LEFT_SHOULDER][:2]
        right_shoulder = landmarks.landmarks[_RIGHT_SHOULDER][:2]

        shoulder_axis = (right_shoulder[0] - left_shoulder[0], right_shoulder[1] - left_shoulder[1])
        shoulder_width = math.sqrt(shoulder_axis[0] ** 2 + shoulder_axis[1] ** 2)
        if shoulder_width == 0:
            return None

        shoulder_mid = (
            (left_shoulder[0] + right_shoulder[0]) / 2,
            (left_shoulder[1] + right_shoulder[1]) / 2,
        )

        return PostureMeasurement(
            head_forward=(nose[0] - shoulder_mid[0]) / shoulder_width,
            head_drop=(nose[1] - shoulder_mid[1]) / shoulder_width,
            shoulder_roll=(left_shoulder[1] - right_shoulder[1]) / shoulder_width,
        )
    except (KeyError, IndexError, ZeroDivisionError):
        return None


@dataclass(frozen=True)
class PostureDeviation:
    """Represents how a current posture differs from a baseline.

    All values are differences from baseline (positive/negative indicates
    direction of deviation).
    """

    head_forward_diff: float
    head_drop_diff: float
    shoulder_roll_diff: float

    def magnitude(self) -> float:
        """Calculate overall deviation magnitude (Euclidean distance)."""
        return math.sqrt(
            self.head_forward_diff ** 2
            + self.head_drop_diff ** 2
            + self.shoulder_roll_diff ** 2
        )

    def to_dict(self) -> dict[str, float]:
        """Convert to dictionary for event serialization."""
        return {
            "head_forward_diff": round(self.head_forward_diff, 4),
            "head_drop_diff": round(self.head_drop_diff, 4),
            "shoulder_roll_diff": round(self.shoulder_roll_diff, 4),
            "magnitude": round(self.magnitude(), 4),
        }


def calculate_deviation(
    current: PostureMeasurement, baseline: PostureMeasurement
) -> PostureDeviation:
    """Calculate how a current posture deviates from a baseline.

    Args:
        current: Current posture measurement.
        baseline: Baseline posture measurement.

    Returns:
        PostureDeviation with the differences.
    """
    return PostureDeviation(
        head_forward_diff=current.head_forward - baseline.head_forward,
        head_drop_diff=current.head_drop - baseline.head_drop,
        shoulder_roll_diff=current.shoulder_roll - baseline.shoulder_roll,
    )