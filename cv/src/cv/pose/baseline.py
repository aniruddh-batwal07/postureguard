"""Per-session posture baseline calculation.

Takes a sequence of posture measurements collected during the upright-posture
window and computes a baseline by averaging. The baseline is the reference
future measurements are compared against.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass

from cv.pose.posture import PostureMeasurement


class BaselineError(RuntimeError):
    """Raised when a baseline cannot be computed from the given samples."""


@dataclass(frozen=True)
class PostureBaseline:
    """The per-session upright-posture baseline.

    Stores the mean of each posture feature across the calibration window.
    """

    head_forward: float
    head_drop: float
    shoulder_roll: float
    sample_count: int

    def to_measurement(self) -> PostureMeasurement:
        """Return the baseline as a PostureMeasurement for deviation calc."""
        return PostureMeasurement(
            head_forward=self.head_forward,
            head_drop=self.head_drop,
            shoulder_roll=self.shoulder_roll,
        )

    def to_dict(self) -> dict[str, float]:
        """Convert to dictionary for event serialization."""
        return {
            "head_forward": round(self.head_forward, 4),
            "head_drop": round(self.head_drop, 4),
            "shoulder_roll": round(self.shoulder_roll, 4),
            "sample_count": self.sample_count,
        }


def compute_baseline(measurements: list[PostureMeasurement]) -> PostureBaseline:
    """Compute a baseline posture from a series of measurements.

    Args:
        measurements: Posture measurements collected during the upright window.
            Must be non-empty.

    Returns:
        PostureBaseline with mean values of each feature.

    Raises:
        BaselineError: if the measurement list is empty.
    """
    if not measurements:
        raise BaselineError("cannot compute baseline from empty measurement list")

    if any(
        not all(math.isfinite(value) for value in measurement.to_dict().values())
        for measurement in measurements
    ):
        raise BaselineError("cannot compute baseline from invalid measurements")

    def _mean(values: list[float]) -> float:
        return statistics.fmean(values)

    return PostureBaseline(
        head_forward=_mean([m.head_forward for m in measurements]),
        head_drop=_mean([m.head_drop for m in measurements]),
        shoulder_roll=_mean([m.shoulder_roll for m in measurements]),
        sample_count=len(measurements),
    )


class BaselineCollector:
    """Collects posture measurements during calibration and computes the baseline.

    Supports a configured minimum sample count. Sampling stops once enough
    valid measurements are collected.
    """

    def __init__(self, min_samples: int) -> None:
        if min_samples < 1:
            raise ValueError("min_samples must be >= 1")
        self._min_samples = min_samples
        self._samples: list[PostureMeasurement] = []

    def add_measurement(self, measurement: PostureMeasurement | None) -> bool:
        """Add a measurement to the baseline window.

        Args:
            measurement: posture measurement or None (invalid/missing landmarks).

        Returns:
            True if enough samples have been collected (baseline now ready),
            False otherwise. None samples are silently ignored.
        """
        if measurement is not None and all(
            math.isfinite(value) for value in measurement.to_dict().values()
        ):
            self._samples.append(measurement)
        return len(self._samples) >= self._min_samples

    @property
    def sample_count(self) -> int:
        return len(self._samples)

    @property
    def is_ready(self) -> bool:
        return len(self._samples) >= self._min_samples

    def compute(self) -> PostureBaseline:
        """Compute the baseline from collected samples.

        Raises:
            BaselineError: if not enough samples collected yet.
        """
        if not self.is_ready:
            raise BaselineError(
                f"need {self._min_samples} samples, have {len(self._samples)}"
            )
        return compute_baseline(self._samples)