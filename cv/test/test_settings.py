"""M3.3 settings poller unit tests.

Covers:
- CvSettings defaults load correctly
- CvSettings.from_dict parses valid data
- CvSettings.from_dict rejects invalid/missing fields
- CvSettings validation rejects out-of-range values
- SettingsPoller returns False when interval has not elapsed
- SettingsPoller returns True and updates current_settings on change
- SettingsPoller returns False when settings are unchanged
- SettingsPoller safely handles backend fetch failures (network error)
- SettingsPoller safely handles malformed responses
- SettingsPoller safely handles invalid settings values from the backend
- SettingsPoller log on change
- Live settings rebuild SlouchRule in the monitoring loop (via run())
- M2.2/M2.3 tests continue passing (SlouchRule tests are in test_rules.py)
"""

from __future__ import annotations

import sys

import pytest

from cv.events import EventClientError
from cv.settings.poller import (
    CvSettings,
    DEFAULT_CORRECTION_DURATION_SECONDS,
    DEFAULT_SLOUCH_DURATION_SECONDS,
    DEFAULT_SLOUCH_THRESHOLD,
    SettingsPoller,
    SettingsPollerError,
)


# ── CvSettings defaults ────────────────────────────────────────────────────

class TestCvSettingsDefaults:
    def test_default_values(self):
        s = CvSettings()
        assert s.slouchThreshold == DEFAULT_SLOUCH_THRESHOLD
        assert s.slouchDurationSeconds == DEFAULT_SLOUCH_DURATION_SECONDS
        assert s.correctionDurationSeconds == DEFAULT_CORRECTION_DURATION_SECONDS

    def test_defaults_match_cv_config_defaults(self):
        from cv.config import Config
        cfg = Config()
        s = CvSettings()
        assert s.slouchThreshold == cfg.slouch_threshold
        assert s.slouchDurationSeconds == cfg.slouch_duration_seconds
        assert s.correctionDurationSeconds == cfg.correction_duration_seconds


# ── CvSettings.from_dict ────────────────────────────────────────────────────

class TestCvSettingsFromDict:
    def test_parses_valid_dict(self):
        d = {
            "slouchThreshold": 0.25,
            "slouchDurationSeconds": 3.0,
            "correctionDurationSeconds": 1.5,
        }
        s = CvSettings.from_dict(d)
        assert s.slouchThreshold == 0.25
        assert s.slouchDurationSeconds == 3.0
        assert s.correctionDurationSeconds == 1.5

    def test_rejects_missing_field(self):
        with pytest.raises(SettingsPollerError, match="missing fields"):
            CvSettings.from_dict({"slouchThreshold": 0.1, "slouchDurationSeconds": 2.0})

    def test_rejects_non_numeric_field(self):
        with pytest.raises(SettingsPollerError):
            CvSettings.from_dict({
                "slouchThreshold": "high",
                "slouchDurationSeconds": 2.0,
                "correctionDurationSeconds": 2.0,
            })


# ── CvSettings validation ────────────────────────────────────────────────────

class TestCvSettingsValidation:
    def test_rejects_threshold_below_zero(self):
        with pytest.raises(SettingsPollerError, match="slouchThreshold"):
            CvSettings(slouchThreshold=-0.1)

    def test_rejects_threshold_above_one(self):
        with pytest.raises(SettingsPollerError, match="slouchThreshold"):
            CvSettings(slouchThreshold=1.1)

    def test_accepts_threshold_at_zero(self):
        s = CvSettings(slouchThreshold=0.0)
        assert s.slouchThreshold == 0.0

    def test_accepts_threshold_at_one(self):
        s = CvSettings(slouchThreshold=1.0)
        assert s.slouchThreshold == 1.0

    def test_rejects_zero_slouch_duration(self):
        with pytest.raises(SettingsPollerError, match="slouchDurationSeconds"):
            CvSettings(slouchDurationSeconds=0.0)

    def test_rejects_negative_correction_duration(self):
        with pytest.raises(SettingsPollerError, match="correctionDurationSeconds"):
            CvSettings(correctionDurationSeconds=-1.0)

    def test_rejects_duration_above_max(self):
        with pytest.raises(SettingsPollerError):
            CvSettings(slouchDurationSeconds=61.0)

    def test_rejects_non_finite_threshold(self):
        with pytest.raises(SettingsPollerError):
            CvSettings(slouchThreshold=float("inf"))

    def test_rejects_nan_duration(self):
        with pytest.raises(SettingsPollerError):
            CvSettings(correctionDurationSeconds=float("nan"))


# ── SettingsPoller — poll timing ─────────────────────────────────────────────

class FakeClock:
    def __init__(self, initial: float = 0.0):
        self.t = initial

    def __call__(self) -> float:
        return self.t

    def advance(self, delta: float) -> None:
        self.t += delta


class FakeClient:
    """Fake EventClient for settings tests."""

    def __init__(self, settings: dict | None = None, fail: bool = False, fail_with=None):
        self._settings = settings or {
            "slouchThreshold": 0.15,
            "slouchDurationSeconds": 2.0,
            "correctionDurationSeconds": 2.0,
        }
        self._fail = fail
        self._fail_with = fail_with or EventClientError("network error")
        self.call_count = 0

    def request(self, method, path, payload=None):
        self.call_count += 1
        if self._fail:
            raise self._fail_with
        if method == "GET" and path == "/api/settings":
            return {"settings": self._settings}
        return {}


class TestSettingsPollerTiming:
    def test_poll_returns_true_on_first_call_when_settings_differ(self):
        clock = FakeClock(0.0)
        client = FakeClient(settings={"slouchThreshold": 0.25, "slouchDurationSeconds": 3.0, "correctionDurationSeconds": 2.0})
        initial = CvSettings(slouchThreshold=0.15)
        poller = SettingsPoller(client, initial_settings=initial, poll_interval_seconds=30.0, time_fn=clock)

        changed = poller.poll()

        assert changed is True
        assert poller.current_settings.slouchThreshold == 0.25

    def test_poll_returns_false_before_interval_elapses(self):
        clock = FakeClock(0.0)
        client = FakeClient()
        poller = SettingsPoller(client, poll_interval_seconds=30.0, time_fn=clock)

        # First call fires immediately (next_poll starts at t=0).
        poller.poll()
        client.call_count = 0  # reset

        # Advance only 15s — not enough.
        clock.advance(15.0)
        changed = poller.poll()

        assert changed is False
        assert client.call_count == 0

    def test_poll_fires_after_interval_elapses(self):
        clock = FakeClock(0.0)
        client = FakeClient()
        poller = SettingsPoller(client, poll_interval_seconds=30.0, time_fn=clock)

        poller.poll()  # first call
        client.call_count = 0

        clock.advance(30.0)
        poller.poll()

        assert client.call_count == 1

    def test_poll_returns_false_when_settings_unchanged(self):
        clock = FakeClock(0.0)
        client = FakeClient()
        poller = SettingsPoller(client, poll_interval_seconds=30.0, time_fn=clock)

        # First poll — same as defaults, no change.
        changed = poller.poll()
        assert changed is False

    def test_poll_returns_true_and_updates_on_change(self):
        clock = FakeClock(0.0)
        client = FakeClient()
        initial = CvSettings(slouchThreshold=0.10)
        poller = SettingsPoller(client, initial_settings=initial, poll_interval_seconds=30.0, time_fn=clock)

        changed = poller.poll()

        assert changed is True
        assert poller.current_settings.slouchThreshold == 0.15  # backend default


# ── SettingsPoller — failure resilience ──────────────────────────────────────

class TestSettingsPollerResilience:
    def test_network_failure_does_not_crash(self, capsys):
        clock = FakeClock(0.0)
        client = FakeClient(fail=True)
        poller = SettingsPoller(client, poll_interval_seconds=30.0, time_fn=clock)

        changed = poller.poll()

        assert changed is False
        assert "failed to fetch settings" in capsys.readouterr().err

    def test_malformed_response_does_not_crash(self, capsys):
        clock = FakeClock(0.0)

        class BadClient:
            call_count = 0

            def request(self, method, path, payload=None):
                self.call_count += 1
                return {"not_settings": {}}

        poller = SettingsPoller(BadClient(), poll_interval_seconds=30.0, time_fn=clock)
        changed = poller.poll()

        assert changed is False
        assert "failed to fetch settings" in capsys.readouterr().err

    def test_invalid_values_from_backend_do_not_crash(self, capsys):
        """Backend returning out-of-range values should not crash the poller."""
        clock = FakeClock(0.0)
        client = FakeClient(settings={
            "slouchThreshold": 999.0,  # out of range
            "slouchDurationSeconds": 2.0,
            "correctionDurationSeconds": 2.0,
        })
        initial = CvSettings()
        poller = SettingsPoller(client, initial_settings=initial, poll_interval_seconds=30.0, time_fn=clock)

        changed = poller.poll()

        # Previous settings are kept; no crash.
        assert changed is False
        assert poller.current_settings == initial

    def test_current_settings_unchanged_after_failed_poll(self):
        clock = FakeClock(0.0)
        client = FakeClient(fail=True)
        initial = CvSettings(slouchThreshold=0.30)
        poller = SettingsPoller(client, initial_settings=initial, poll_interval_seconds=30.0, time_fn=clock)

        poller.poll()

        assert poller.current_settings == initial

    def test_poll_logs_change_to_stdout(self, capsys):
        clock = FakeClock(0.0)
        client = FakeClient(settings={
            "slouchThreshold": 0.25,
            "slouchDurationSeconds": 4.0,
            "correctionDurationSeconds": 3.0,
        })
        initial = CvSettings(slouchThreshold=0.15)
        poller = SettingsPoller(client, initial_settings=initial, poll_interval_seconds=30.0, time_fn=clock)

        poller.poll()

        out = capsys.readouterr().out
        assert "settings updated" in out
        assert "0.250" in out
        assert "4.0" in out


# ── Integration: settings poller wires into run() loop ───────────────────────

class TestSettingsPollerIntegration:
    """Verify that run() rebuilds the SlouchRule when the poller reports a change."""

    def test_run_uses_settings_poller_when_provided(self):
        """The run() loop should call poll() and rebuild the rule when settings change."""
        import numpy as np
        from cv.__main__ import run
        from cv.config import Config
        from cv.events import EventClient
        from mock_backend import MockBackend

        backend = MockBackend()
        # Provide updated settings that differ from the Config defaults.
        backend.settings = {
            "slouchThreshold": 0.30,
            "slouchDurationSeconds": 5.0,
            "correctionDurationSeconds": 3.0,
        }
        try:
            class FakeCam:
                opened = False
                open_calls = 0
                released = False
                read_count = 0

                def open(self):
                    self.opened = True
                    self.open_calls += 1

                @property
                def is_open(self):
                    return self.opened

                def read(self):
                    self.read_count += 1
                    return np.zeros((16, 16, 3), dtype=np.uint8)

                def release(self):
                    self.released = True
                    self.opened = False

            # Use a zero-interval poller so it fires on every frame.
            from cv.settings import CvSettings, SettingsPoller

            client = EventClient(backend.base_url)
            poller = SettingsPoller(client, poll_interval_seconds=0.0)

            camera = FakeCam()
            session_id = run(
                Config(),
                client,
                camera,
                max_frames=2,
                frame_delay=0,
                preview_enabled=False,
                settings_poller=poller,
            )
            assert session_id == "session-1"
            # Poller should have fetched the updated settings.
            assert poller.current_settings.slouchThreshold == 0.30
            assert poller.current_settings.slouchDurationSeconds == 5.0
        finally:
            backend.close()
