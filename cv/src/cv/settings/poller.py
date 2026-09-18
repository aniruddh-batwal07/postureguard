"""Live settings polling from the backend (M3.3).

The ``SettingsPoller`` fetches ``GET /api/settings`` periodically via the
existing ``EventClient`` infrastructure.  It:

- keeps the last valid ``CvSettings`` in memory
- detects changes and returns True from ``poll()`` when settings have changed
- logs failures to stderr and *continues with the previous settings*
- never raises inside ``poll()`` — a transient backend outage must not crash
  the monitoring loop

The ``SlouchRule`` itself stays pure (no HTTP code).  The caller (``__main__``)
is responsible for rebuilding the rule when ``poll()`` signals a change.

Poll interval default: 30 seconds, configurable via
``CV_SETTINGS_POLL_INTERVAL_SECONDS``.
"""

from __future__ import annotations

import math
import os
import sys
import time
from dataclasses import dataclass

from cv.events import EventClient, EventClientError

# ── Constants (mirror backend/src/settings/defaults.js) ────────────────────

DEFAULT_SLOUCH_THRESHOLD: float = 0.15
DEFAULT_SLOUCH_DURATION_SECONDS: float = 2.0
DEFAULT_CORRECTION_DURATION_SECONDS: float = 2.0

# ── Validation ranges (mirror backend/src/validation/settings.js) ───────────

_THRESHOLD_MIN = 0.0
_THRESHOLD_MAX = 1.0
_DURATION_MIN = 0.0  # exclusive
_DURATION_MAX = 60.0  # inclusive


class SettingsPollerError(ValueError):
    """Raised when a fetched settings payload is structurally invalid."""


@dataclass(frozen=True)
class CvSettings:
    """Immutable snapshot of the current slouch-rule configuration.

    Field names mirror the JSON keys returned by ``GET /api/settings``
    (camelCase) so the poller can construct instances directly from the
    response dict without any renaming.
    """

    slouchThreshold: float = DEFAULT_SLOUCH_THRESHOLD
    slouchDurationSeconds: float = DEFAULT_SLOUCH_DURATION_SECONDS
    correctionDurationSeconds: float = DEFAULT_CORRECTION_DURATION_SECONDS

    def __post_init__(self) -> None:
        _validate_settings(self)

    @classmethod
    def from_dict(cls, data: dict) -> "CvSettings":
        """Build a ``CvSettings`` from a parsed API response dict.

        Raises ``SettingsPollerError`` when any required field is missing or
        has an invalid value so the poller can catch it and log safely.
        """
        required = ("slouchThreshold", "slouchDurationSeconds", "correctionDurationSeconds")
        missing = [k for k in required if k not in data]
        if missing:
            raise SettingsPollerError(f"settings response missing fields: {missing}")
        try:
            return cls(
                slouchThreshold=float(data["slouchThreshold"]),
                slouchDurationSeconds=float(data["slouchDurationSeconds"]),
                correctionDurationSeconds=float(data["correctionDurationSeconds"]),
            )
        except (TypeError, ValueError) as exc:
            raise SettingsPollerError(f"settings field has non-numeric value: {exc}") from exc


def _validate_settings(s: CvSettings) -> None:
    """Validate a CvSettings instance; raise SettingsPollerError on any violation."""
    if not math.isfinite(s.slouchThreshold):
        raise SettingsPollerError("slouchThreshold must be finite")
    if s.slouchThreshold < _THRESHOLD_MIN or s.slouchThreshold > _THRESHOLD_MAX:
        raise SettingsPollerError(
            f"slouchThreshold must be in [{_THRESHOLD_MIN}, {_THRESHOLD_MAX}], got {s.slouchThreshold}"
        )
    for name, value in (
        ("slouchDurationSeconds", s.slouchDurationSeconds),
        ("correctionDurationSeconds", s.correctionDurationSeconds),
    ):
        if not math.isfinite(value):
            raise SettingsPollerError(f"{name} must be finite")
        if value <= _DURATION_MIN or value > _DURATION_MAX:
            raise SettingsPollerError(
                f"{name} must be in ({_DURATION_MIN}, {_DURATION_MAX}], got {value}"
            )


class SettingsPoller:
    """Periodic poller that fetches and validates settings from the backend.

    Lifecycle
    ---------
    1. Construct with an ``EventClient`` and the initial settings (normally
       loaded from the backend on startup or from the process ``Config``).
    2. Call ``poll()`` from the monitoring loop; it is a no-op until the
       poll interval has elapsed, then it fetches and compares.
    3. If ``poll()`` returns ``True``, the caller should rebuild the
       ``SlouchRule`` using ``current_settings``.

    All network / JSON / validation errors inside ``poll()`` are caught, logged
    to stderr, and treated as "no change" — the previous settings remain active.
    """

    def __init__(
        self,
        client: EventClient,
        initial_settings: CvSettings | None = None,
        poll_interval_seconds: float | None = None,
        time_fn=None,
    ) -> None:
        self._client = client
        self._current = initial_settings or CvSettings()
        if poll_interval_seconds is None:
            poll_interval_seconds = float(
                os.environ.get("CV_SETTINGS_POLL_INTERVAL_SECONDS", 30.0)
            )
        self._interval = poll_interval_seconds
        self._time_fn = time_fn or time.monotonic
        self._next_poll_at: float = self._time_fn()  # poll immediately on first call

    @property
    def current_settings(self) -> CvSettings:
        """The most recently validated settings (never None)."""
        return self._current

    def poll(self) -> bool:
        """Check if it is time to poll, then fetch and compare.

        Returns ``True`` if the settings changed, ``False`` otherwise.
        Never raises.
        """
        now = self._time_fn()
        if now < self._next_poll_at:
            return False

        self._next_poll_at = now + self._interval

        try:
            body = self._client.request("GET", "/api/settings")
            raw = body.get("settings")
            if not isinstance(raw, dict):
                raise SettingsPollerError(f"unexpected settings payload type: {type(raw)}")
            fetched = CvSettings.from_dict(raw)
        except (EventClientError, SettingsPollerError, KeyError) as exc:
            print(
                f"[cv/settings] failed to fetch settings: {exc}",
                file=sys.stderr,
                flush=True,
            )
            return False
        except Exception as exc:  # pylint: disable=broad-except
            print(
                f"[cv/settings] unexpected error fetching settings: {exc}",
                file=sys.stderr,
                flush=True,
            )
            return False

        if fetched == self._current:
            return False

        print(
            f"[cv/settings] settings updated: "
            f"threshold={fetched.slouchThreshold:.3f} "
            f"slouch_duration={fetched.slouchDurationSeconds:.1f}s "
            f"correction_duration={fetched.correctionDurationSeconds:.1f}s",
            flush=True,
        )
        self._current = fetched
        return True
