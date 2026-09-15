"""Slouch detection with sustained-condition debounce (M2.3).

Pure rule state, no camera / MediaPipe / backend dependencies, so the timing and
state transitions are fully deterministic and unit-testable with synthetic
measurements and injected timestamps.

Flow:

- Every ``update()`` call classifies the current ``PostureMeasurement`` against
  the session baseline as one of:

    - ``bad``      — finite deviation magnitude > ``slouch_threshold``
    - ``good``     — finite deviation magnitude <= ``slouch_threshold``
    - ``unknown``  — measurement is None or contains non-finite values

- "unknown" samples reset the active timer and never trigger anything: a missing
  face/landmarks should not silently produce a violation (or a correction).

- In the upright state, "bad" samples must stay bad for >= ``slouch_duration_seconds``
  (continuously; any "good"/"unknown" resets the timer) before a single
  ``slouch_violation`` event is emitted and the rule enters the slouched state.

- In the slouched state, "good" samples must stay good for >=
  ``correction_duration_seconds`` (any "bad"/"unknown" resets the timer) before a
  single ``correction_requested`` event is emitted and the rule returns to the
  upright state.

While a condition stays active no further events are emitted: exactly one
``slouch_violation`` per slouch episode and exactly one ``correction_requested``
per recovery.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from cv.pose.posture import PostureMeasurement, calculate_deviation

EVENT_SLOUCH_VIOLATION = "slouch_violation"
EVENT_CORRECTION_REQUESTED = "correction_requested"

BAD = "bad"
GOOD = "good"
UNKNOWN = "unknown"


class SlouchRuleError(ValueError):
    """Raised when the rule is constructed with invalid parameters."""


@dataclass
class SlouchRule:
    """State machine deciding when posture violations and corrections occur.

    Args:
        baseline: the per-session upright-posture measurement to compare against.
        slouch_threshold: deviation magnitude that counts as slouched.
        slouch_duration_seconds: how long the slouched condition must hold
            before ``slouch_violation`` fires.
        correction_duration_seconds: how long the recovered condition must hold
            after a violation before ``correction_requested`` fires.
    """

    baseline: PostureMeasurement
    slouch_threshold: float = 0.15
    slouch_duration_seconds: float = 2.0
    correction_duration_seconds: float = 2.0

    _slouch_active: bool = field(default=False, init=False, repr=False)
    _slouch_since: float | None = field(default=None, init=False, repr=False)
    _correction_since: float | None = field(default=None, init=False, repr=False)
    _last_condition: str = field(default="good", init=False, repr=False)

    def __post_init__(self) -> None:
        if self.slouch_threshold < 0:
            raise SlouchRuleError("slouch_threshold must be >= 0")
        if not math.isfinite(self.slouch_threshold):
            raise SlouchRuleError("slouch_threshold must be finite")
        for duration in (self.slouch_duration_seconds, self.correction_duration_seconds):
            if duration <= 0 or not math.isfinite(duration):
                raise SlouchRuleError("rule durations must be positive and finite")

    def update(self, measurement: PostureMeasurement | None, t: float) -> list[str]:
        """Feed one posture sample taken at timestamp ``t``.

        Args:
            measurement: current posture measurement, or None when no valid
                landmarks were seen.
            t: monotonic timestamp of the sample (e.g. ``time.monotonic()``).

        Returns:
            list of events emitted (normally empty):
            ``["slouch_violation"]`` and/or ``["correction_requested"]``.
        """
        events: list[str] = []
        condition = self._classify(measurement)
        self._last_condition = condition

        if condition == UNKNOWN:
            self._slouch_since = None
            self._correction_since = None
            return events

        if self._slouch_active:
            if condition != GOOD:
                self._correction_since = None
            elif self._correction_since is None:
                self._correction_since = t
            elif t - self._correction_since >= self.correction_duration_seconds:
                events.append(EVENT_CORRECTION_REQUESTED)
                self._slouch_active = False
                self._correction_since = None
        else:
            if condition == BAD:
                if self._slouch_since is None:
                    self._slouch_since = t
                elif t - self._slouch_since >= self.slouch_duration_seconds:
                    events.append(EVENT_SLOUCH_VIOLATION)
                    self._slouch_active = True
                    self._slouch_since = None
            else:
                self._slouch_since = None

        return events

    def reset(self) -> None:
        """Return the rule to its initial upright, no-events-pending state."""
        self._slouch_active = False
        self._slouch_since = None
        self._correction_since = None
        self._last_condition = GOOD

    @property
    def slouch_active(self) -> bool:
        """True after a ``slouch_violation`` fires until it is corrected/returned."""
        return self._slouch_active

    @property
    def condition(self) -> str:
        """Classification of the most recently seen sample (bad/good/unknown)."""
        return self._last_condition

    @property
    def slouch_since(self) -> float | None:
        """Timestamp the current slouched run started, or None if not slouching."""
        return self._slouch_since

    @property
    def correction_since(self) -> float | None:
        """Timestamp the current recovered run started, or None if not recovering."""
        return self._correction_since

    def _classify(self, measurement: PostureMeasurement | None) -> str:
        if measurement is None:
            return UNKNOWN
        if not all(
            math.isfinite(value)
            for value in (
                measurement.head_forward,
                measurement.head_drop,
                measurement.shoulder_roll,
            )
        ):
            return UNKNOWN
        deviation = calculate_deviation(measurement, self.baseline)
        if deviation.magnitude() > self.slouch_threshold:
            return BAD
        return GOOD