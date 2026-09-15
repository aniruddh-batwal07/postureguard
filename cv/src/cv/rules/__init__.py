"""M2.3 violation rules / debounce logic.

Pure, deterministic state logic that converts a stream of posture measurements
(after the M2.2 baseline) into ``slouch_violation`` / ``correction_requested``
events, independent of the camera, MediaPipe, and backend.
"""

from cv.rules.slouch import (
    EVENT_CORRECTION_REQUESTED,
    EVENT_SLOUCH_VIOLATION,
    SlouchRule,
    SlouchRuleError,
)

__all__ = [
    "EVENT_CORRECTION_REQUESTED",
    "EVENT_SLOUCH_VIOLATION",
    "SlouchRule",
    "SlouchRuleError",
]