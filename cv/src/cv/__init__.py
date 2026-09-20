"""PostureGuard computer vision package."""

from cv.daemon import (
    EVENT_BASELINE_CAPTURED,
    STATE_ATTACHED_UNCONFIGURED,
    STATE_CAPTURING_BASELINE,
    STATE_MONITORING_ACTIVE,
    STATE_STANDBY,
    CvDaemon,
)

__version__ = "0.1.0"

__all__ = [
    "CvDaemon",
    "STATE_STANDBY",
    "STATE_ATTACHED_UNCONFIGURED",
    "STATE_CAPTURING_BASELINE",
    "STATE_MONITORING_ACTIVE",
    "EVENT_BASELINE_CAPTURED",
    "__version__",
]