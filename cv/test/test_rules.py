"""M2.3 slouch/debounce rule unit tests (pure logic, deterministic timestamps).

Covers the required scenarios:

- brief (below-duration) bad posture never triggers
- sustained bad posture triggers exactly one ``slouch_violation``
- continued bad posture does not duplicate the event
- temporary recovery does not trigger ``correction_requested``
- sustained recovery triggers exactly one ``correction_requested``
- repeated slouch/recover cycles
- reset() clears state
- exact boundary timing (>= duration triggers, < duration does not)
- invalid / non-finite measurements are safely ignored
- constructor parameter validation
- config integration (defaults + environment parsing)
"""

from __future__ import annotations

import pytest

from cv.config import Config
from cv.pose.posture import PostureMeasurement
from cv.rules import (
    EVENT_CORRECTION_REQUESTED,
    EVENT_SLOUCH_VIOLATION,
    SlouchRule,
    SlouchRuleError,
)

# Baseline = neutral, deviation-free reference posture. The rule classifies by
# DEVIATION from the baseline only, so a neutral baseline makes the sample
# magnitudes below exact and easy to reason about.
BASELINE = PostureMeasurement(head_forward=0.0, head_drop=0.0, shoulder_roll=0.0)

# Deviation magnitudes at the default threshold of 0.15 (baseline is neutral):
# - GOOD:      0.0                 (identical to baseline)
# - NEAR_BELOW ~0.141  < 0.15      (largest "good" sample used for boundary tests)
# - NEAR_ABOVE ~0.156  > 0.15      (smallest "bad" sample used for boundary tests)
# - BAD:       ~0.357  > 0.15      (clearly slouched)
GOOD = BASELINE
NEAR_BELOW = PostureMeasurement(head_forward=0.1, head_drop=0.1, shoulder_roll=0.0)
NEAR_ABOVE = PostureMeasurement(head_forward=0.11, head_drop=0.11, shoulder_roll=0.0)
BAD = PostureMeasurement(head_forward=0.25, head_drop=0.25, shoulder_roll=0.05)


def feed(rule: SlouchRule, samples: list[tuple[PostureMeasurement | None, float]]) -> list[str]:
    """Push a ``(measurement, timestamp)`` sequence through the rule."""
    events: list[str] = []
    for measurement, t in samples:
        events.extend(rule.update(measurement, t))
    return events


class TestBoundaryClassification:
    def test_magnitude_below_threshold_is_good_not_violating(self):
        rule = SlouchRule(BASELINE)
        events = feed(rule, [(NEAR_BELOW, t) for t in (0.0, 1.0, 2.0, 3.0, 10.0)])
        assert events == []
        assert rule.condition == "good"

    def test_exactly_at_threshold_is_not_beyond_it(self):
        # 0.25 is exactly representable; a sample deviating by exactly the
        # threshold (0.25, 0, 0) has magnitude == 0.25 which is NOT > 0.25.
        rule = SlouchRule(BASELINE, slouch_threshold=0.25)
        exact = PostureMeasurement(head_forward=0.25, head_drop=0.0, shoulder_roll=0.0)
        events = feed(rule, [(exact, 0.0), (exact, 2.0)])
        assert events == []

        # The same sample one micro-epsilon beyond the threshold DOES trigger,
        # pinning the strictly-greater-than semantics on the boundary.
        rule = SlouchRule(BASELINE, slouch_threshold=0.25)
        above = PostureMeasurement(head_forward=0.250001, head_drop=0.0, shoulder_roll=0.0)
        events = feed(rule, [(above, 0.0), (above, 2.0)])
        assert events == [EVENT_SLOUCH_VIOLATION]


class TestViolation:
    def test_brief_bad_posture_never_triggers(self):
        rule = SlouchRule(BASELINE)  # duration 2.0
        events = feed(
            rule,
            [
                (GOOD, 0.0),
                (BAD, 1.0),  # starts slouched run
                (BAD, 1.9),  # sustained < 2.0s
                (GOOD, 2.0),  # recovers before the duration elapses
                (GOOD, 3.0),
            ],
        )
        assert events == []
        assert not rule.slouch_active

    def test_sustained_bad_triggers_exactly_one_violation(self):
        rule = SlouchRule(BASELINE)
        events = feed(
            rule,
            [
                (BAD, 0.0),
                (BAD, 1.9),  # below-duration: no event yet
                (BAD, 2.0),  # exactly the duration boundary
            ],
        )
        assert events == [EVENT_SLOUCH_VIOLATION]
        assert rule.slouch_active

    def test_continued_bad_does_not_duplicate_violation(self):
        rule = SlouchRule(BASELINE)
        events = feed(
            rule,
            [
                (BAD, 0.0),
                (BAD, 2.0),  # fires the violation
                (BAD, 2.1),  # still slouched
                (BAD, 10.0),  # still slouched
                (BAD, 60.0),  # still slouched
            ],
        )
        assert events == [EVENT_SLOUCH_VIOLATION]

    def test_fine_grained_timeline_fires_only_on_duration_boundary(self):
        rule = SlouchRule(BASELINE)
        events: list[str] = []
        t = 0.0
        for i in range(21):
            events.extend(rule.update(NEAR_ABOVE, t))
            t = round(t + 0.1, 6)
        assert events == [EVENT_SLOUCH_VIOLATION]

    def test_boundary_below_duration_does_not_trigger_just_before(self):
        rule = SlouchRule(BASELINE)
        events = feed(rule, [(BAD, 0.0), (BAD, 1.999)])
        assert events == []

    def test_nonzero_threshold_allows_identical_posture(self):
        rule = SlouchRule(BASELINE, slouch_threshold=0.0)
        events = feed(rule, [(GOOD, 0.0), (GOOD, 2.0)])
        assert events == []

    def test_unknown_sample_resets_slouch_timer(self):
        rule = SlouchRule(BASELINE)
        events = feed(
            rule,
            [
                (BAD, 0.0),  # start slouched run
                (None, 1.0),  # landmarks lost -> timer reset
                (BAD, 2.0),  # restart run at 2.0
                (BAD, 3.0),  # only 1.0s of the new run
                (BAD, 4.0),  # 2.0s -> fires now, not earlier
            ],
        )
        assert events == [EVENT_SLOUCH_VIOLATION]
        assert rule.slouch_active

    def test_non_finite_measurements_are_ignored_never_trigger(self):
        rule = SlouchRule(BASELINE)
        for field in ("head_forward", "head_drop", "shoulder_roll"):
            for non_finite in (float("nan"), float("inf"), float("-inf")):
                rule.reset()
                # build a deliberately non-finite measurement
                values = [BAD.head_forward, BAD.head_drop, BAD.shoulder_roll]
                values[{"head_forward": 0, "head_drop": 1, "shoulder_roll": 2}[field]] = non_finite
                sample = PostureMeasurement(*values)
                events = feed(rule, [(BAD, 0.0), (sample, 1.0), (BAD, 3.0), (BAD, 4.0)])
                # BAD at 0.0 starts a run; the non-finite sample at 1.0 resets it;
                # the run restarts at 3.0 -> violation only at 5.0 (not reached).
                assert events == []
                assert not rule.slouch_active


class TestCorrection:
    def _violated(self, rule: SlouchRule) -> None:
        feed(rule, [(BAD, 0.0), (BAD, 2.0)])
        assert rule.slouch_active

    def test_temporary_recovery_does_not_trigger_correction(self):
        rule = SlouchRule(BASELINE)
        self._violated(rule)
        events = feed(
            rule,
            [
                (GOOD, 2.5),  # recovery starts
                (GOOD, 2.9),  # < 2.0s of recovery
                (BAD, 3.0),  # slouches again -> recovery timer reset
                (BAD, 5.0),
            ],
        )
        assert events == []
        assert rule.slouch_active  # still slouched (never corrected)

    def test_sustained_recovery_triggers_exactly_one_correction(self):
        rule = SlouchRule(BASELINE)
        self._violated(rule)
        events = feed(
            rule,
            [
                (GOOD, 3.0),  # recovery starts
                (GOOD, 4.9),  # < 2.0s
                (GOOD, 5.0),  # exactly 2.0s -> fires
            ],
        )
        assert events == [EVENT_CORRECTION_REQUESTED]
        assert not rule.slouch_active

    def test_continued_good_does_not_duplicate_correction(self):
        rule = SlouchRule(BASELINE)
        self._violated(rule)
        events = feed(
            rule,
            [
                (GOOD, 3.0),
                (GOOD, 5.0),  # fires the correction
                (GOOD, 5.1),  # still recovered
                (GOOD, 30.0),
            ],
        )
        assert events == [EVENT_CORRECTION_REQUESTED]

    def test_unknown_during_recovery_resets_correction_timer(self):
        rule = SlouchRule(BASELINE)
        self._violated(rule)
        events = feed(
            rule,
            [
                (GOOD, 3.0),  # recovery starts
                (None, 3.5),  # landmarks lost -> timer reset
                (GOOD, 4.0),  # recovery restarts here
                (GOOD, 5.0),  # 1.0s of the new run -> no event
                (GOOD, 6.0),  # exactly 2.0s of the new run -> fires now
            ],
        )
        assert events == [EVENT_CORRECTION_REQUESTED]
        assert not rule.slouch_active


class TestRepeatedCycles:
    def test_repeated_violation_correction_cycles(self):
        rule = SlouchRule(BASELINE)
        samples: list[tuple[PostureMeasurement | None, float]] = [
            (BAD, 0.0),
            (BAD, 2.0),  # violation 1
            (GOOD, 3.0),
            (GOOD, 5.0),  # correction 1
            (BAD, 6.0),
            (BAD, 8.0),  # violation 2
            (GOOD, 9.0),
            (GOOD, 11.0),  # correction 2
        ]
        events = feed(rule, samples)
        assert events == [
            EVENT_SLOUCH_VIOLATION,
            EVENT_CORRECTION_REQUESTED,
            EVENT_SLOUCH_VIOLATION,
            EVENT_CORRECTION_REQUESTED,
        ]

    def test_cycle_is_armable_again_after_correction(self):
        rule = SlouchRule(BASELINE)
        feed(rule, [(BAD, 0.0), (BAD, 2.0), (GOOD, 3.0), (GOOD, 5.0)])
        assert not rule.slouch_active
        events = feed(rule, [(BAD, 6.0), (BAD, 8.0)])
        assert events == [EVENT_SLOUCH_VIOLATION]


class TestReset:
    def test_reset_clears_pending_slouch_timer(self):
        rule = SlouchRule(BASELINE)
        feed(rule, [(BAD, 0.0)])  # timer armed, not yet fired
        rule.reset()
        assert not rule.slouch_active
        events = feed(rule, [(BAD, 2.0), (BAD, 4.0)])
        assert events == [EVENT_SLOUCH_VIOLATION]  # fires only after full 2.0s post-reset

    def test_reset_clears_active_violation_and_correction_timer(self):
        rule = SlouchRule(BASELINE)
        self_violated = feed(rule, [(BAD, 0.0), (BAD, 2.0)])
        assert self_violated == [EVENT_SLOUCH_VIOLATION]
        feed(rule, [(GOOD, 3.0)])  # arm correction timer
        rule.reset()
        assert not rule.slouch_active
        assert (rule.condition, rule.slouch_since, rule.correction_since) == ("good", None, None)
        # A brief slouch after reset must not fire: timer restarts from scratch.
        events = feed(rule, [(BAD, 4.0), (GOOD, 4.5)])
        assert events == []


class TestValidation:
    def test_negative_threshold_rejected(self):
        with pytest.raises(SlouchRuleError):
            SlouchRule(BASELINE, slouch_threshold=-0.1)

    def test_non_finite_threshold_rejected(self):
        with pytest.raises(SlouchRuleError):
            SlouchRule(BASELINE, slouch_threshold=float("nan"))

    def test_zero_duration_rejected(self):
        with pytest.raises(SlouchRuleError):
            SlouchRule(BASELINE, slouch_duration_seconds=0)
        with pytest.raises(SlouchRuleError):
            SlouchRule(BASELINE, correction_duration_seconds=0)

    def test_negative_duration_rejected(self):
        with pytest.raises(SlouchRuleError):
            SlouchRule(BASELINE, slouch_duration_seconds=-1)
        with pytest.raises(SlouchRuleError):
            SlouchRule(BASELINE, correction_duration_seconds=-2.5)

    def test_non_finite_duration_rejected(self):
        with pytest.raises(SlouchRuleError):
            SlouchRule(BASELINE, slouch_duration_seconds=float("inf"))

    def test_defaults_and_custom_durations_are_accepted(self):
        rule = SlouchRule(BASELINE)
        assert (rule.slouch_threshold, rule.slouch_duration_seconds, rule.correction_duration_seconds) == (
            0.15,
            2.0,
            2.0,
        )
        custom = SlouchRule(BASELINE, slouch_threshold=0.3, slouch_duration_seconds=5.0, correction_duration_seconds=1.0)
        assert (custom.slouch_threshold, custom.slouch_duration_seconds, custom.correction_duration_seconds) == (
            0.3,
            5.0,
            1.0,
        )


class TestConfigIntegration:
    def test_config_rule_defaults(self):
        config = Config()
        assert (config.slouch_threshold, config.slouch_duration_seconds, config.correction_duration_seconds) == (
            0.15,
            2.0,
            2.0,
        )

    def test_config_from_env_parses_rule_values(self, monkeypatch):
        monkeypatch.setenv("CV_SLOUCH_THRESHOLD", "0.4")
        monkeypatch.setenv("CV_SLOUCH_DURATION_SECONDS", "3.5")
        monkeypatch.setenv("CV_CORRECTION_DURATION_SECONDS", "1.25")
        config = Config.from_env()
        assert (config.slouch_threshold, config.slouch_duration_seconds, config.correction_duration_seconds) == (
            0.4,
            3.5,
            1.25,
        )

    def test_rule_built_from_config(self, monkeypatch):
        monkeypatch.setenv("CV_SLOUCH_THRESHOLD", "0.5")
        monkeypatch.delenv("CV_SLOUCH_DURATION_SECONDS", raising=False)
        config = Config.from_env()
        rule = SlouchRule(
            BASELINE,
            slouch_threshold=config.slouch_threshold,
            slouch_duration_seconds=config.slouch_duration_seconds,
            correction_duration_seconds=config.correction_duration_seconds,
        )
        # threshold 0.5: the default BAD sample (~0.357) no longer violates.
        events = feed(rule, [(BAD, 0.0), (BAD, 3.0)])
        assert events == []