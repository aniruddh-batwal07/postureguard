from typing import Any

import numpy as np
import pytest

from cv.config import Config
from cv.daemon import (
    EVENT_BASELINE_CAPTURED,
    STATE_ATTACHED_UNCONFIGURED,
    STATE_CAPTURING_BASELINE,
    STATE_MONITORING_ACTIVE,
    STATE_STANDBY,
    CvDaemon,
)
from cv.events import EventClient
from cv.pose import PoseLandmarks, PostureBaseline
from cv.rules import EVENT_CORRECTION_REQUESTED, EVENT_SLOUCH_VIOLATION
from cv.settings import CvSettings, SettingsPoller
from mock_backend import MockBackend


class FakeCamera:
    def __init__(self):
        self.opened = False
        self.open_calls = 0
        self.released = False
        self.read_count = 0

    def open(self):
        self.open_calls += 1
        self.opened = True
        return self

    @property
    def is_open(self):
        return self.opened

    def read(self):
        self.read_count += 1
        return np.zeros((16, 16, 3), dtype=np.uint8)

    def release(self):
        self.released = True
        self.opened = False


class FailingDetector:
    def initialize(self):
        return None

    def detect(self, frame):
        return None

    def close(self):
        return None


_UPRIGHT = {
    "NOSE": (0.5, 0.30, 0.0),
    "LEFT_SHOULDER": (0.38, 0.45, 0.0),
    "RIGHT_SHOULDER": (0.60, 0.45, 0.0),
}
_SLOUCHED = {
    "NOSE": (0.55, 0.55, 0.0),
    "LEFT_SHOULDER": (0.38, 0.45, 0.0),
    "RIGHT_SHOULDER": (0.60, 0.45, 0.0),
}
_VISIBILITY = {name: 0.9 for name in ("NOSE", "LEFT_SHOULDER", "RIGHT_SHOULDER")}


def _landmarks(lm: dict[str, tuple[float, float, float]]) -> PoseLandmarks:
    return PoseLandmarks(landmarks=lm, visibility=_VISIBILITY, image_width=16, image_height=16)


class SequenceDetector:
    def __init__(self, results):
        self.results = results
        self.calls = 0
        self.closed = False

    def initialize(self):
        return None

    def detect(self, frame):
        result = self.results[self.calls % len(self.results)]
        self.calls += 1
        return result

    def close(self):
        self.closed = True


class FakeMonotonic:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        self.t += 1.0
        return self.t


def client_for(backend: MockBackend) -> EventClient:
    return EventClient(backend.base_url)


def make_daemon(
    backend: MockBackend,
    camera: FakeCamera | None = None,
    detector: Any | None = None,
    time_fn: Any | None = None,
    baseline_min_samples: int = 1,
    baseline_max_seconds: float = 1.0,
) -> CvDaemon:
    config = Config()
    client = client_for(backend)
    cam = camera or FakeCamera()
    det = detector or SequenceDetector([_landmarks(_UPRIGHT)])
    poller = SettingsPoller(client, initial_settings=CvSettings())
    clk = time_fn or FakeMonotonic()
    return CvDaemon(
        config=config,
        client=client,
        camera=cam,
        detector=det,
        settings_poller=poller,
        preview=None,
        poll_interval=1.0,
        baseline_min_samples=baseline_min_samples,
        baseline_max_seconds=baseline_max_seconds,
        frame_delay=0.0,
        time_fn=clk,
    )


# ── State Machine & Lifecycle Tests ──────────────────────────────────────────


def test_daemon_starts_in_standby_when_no_active_session():
    backend = MockBackend()
    backend.active_session = None
    try:
        daemon = make_daemon(backend)
        status, session = daemon.poll_session()
        daemon.update_session_state(status, session)
        assert daemon.state == STATE_STANDBY
        assert daemon.session_id is None
    finally:
        backend.close()


def test_daemon_transitions_to_attached_unconfigured_when_session_appears():
    backend = MockBackend()
    backend.active_session = {
        "id": "session-100",
        "state": "active",
        "baselineState": "unconfigured",
        "baseline": None,
    }
    try:
        daemon = make_daemon(backend)
        status, session = daemon.poll_session()
        daemon.update_session_state(status, session)
        assert daemon.state == STATE_ATTACHED_UNCONFIGURED
        assert daemon.session_id == "session-100"
        assert daemon.baseline is None
    finally:
        backend.close()


def test_daemon_captures_baseline_and_posts_event_when_requested():
    backend = MockBackend()
    backend.active_session = {
        "id": "session-101",
        "state": "active",
        "baselineState": "capturing",
        "baseline": None,
    }
    try:
        daemon = make_daemon(backend)
        daemon.camera.open()
        status, session = daemon.poll_session()
        daemon.update_session_state(status, session)
        # Check event posted to backend
        events = [e for e in backend.events if e["type"] == EVENT_BASELINE_CAPTURED]
        assert len(events) == 1
        assert events[0]["sessionId"] == "session-101"
        assert "headForward" in events[0]["data"] or "head_forward" in events[0]["data"]
    finally:
        backend.close()


def test_daemon_transitions_to_monitoring_when_backend_confirms_configured():
    backend = MockBackend()
    backend.active_session = {
        "id": "session-102",
        "state": "active",
        "baselineState": "configured",
        "baseline": {
            "headForward": 0.25,
            "headDrop": 0.35,
            "shoulderRoll": 0.15,
            "sampleCount": 30,
        },
    }
    try:
        daemon = make_daemon(backend)
        status, session = daemon.poll_session()
        daemon.update_session_state(status, session)
        assert daemon.state == STATE_MONITORING_ACTIVE
        assert daemon.session_id == "session-102"
        assert daemon.baseline is not None
        assert daemon.baseline.sample_count == 30
        assert daemon.rule is not None
    finally:
        backend.close()


def test_daemon_handles_baseline_reset():
    backend = MockBackend()
    backend.active_session = {
        "id": "session-103",
        "state": "active",
        "baselineState": "configured",
        "baseline": {
            "headForward": 0.25,
            "headDrop": 0.35,
            "shoulderRoll": 0.15,
            "sampleCount": 30,
        },
    }
    try:
        daemon = make_daemon(backend)
        status, session = daemon.poll_session()
        daemon.update_session_state(status, session)
        assert daemon.state == STATE_MONITORING_ACTIVE

        # Simulate baseline reset in backend
        backend.active_session["baselineState"] = "unconfigured"
        backend.active_session["baseline"] = None

        status, session = daemon.poll_session()
        daemon.update_session_state(status, session)

        assert daemon.state == STATE_ATTACHED_UNCONFIGURED
        assert daemon.baseline is None
        assert daemon.rule is None
    finally:
        backend.close()


def test_daemon_handles_session_end():
    backend = MockBackend()
    backend.active_session = {
        "id": "session-104",
        "state": "active",
        "baselineState": "unconfigured",
        "baseline": None,
    }
    try:
        daemon = make_daemon(backend)
        status, session = daemon.poll_session()
        daemon.update_session_state(status, session)
        assert daemon.state == STATE_ATTACHED_UNCONFIGURED

        # End session
        backend.active_session["state"] = "ended"
        status, session = daemon.poll_session()
        daemon.update_session_state(status, session)

        assert daemon.state == STATE_STANDBY
        assert daemon.session_id is None
    finally:
        backend.close()


def test_daemon_handles_session_switch_clearing_old_state():
    backend = MockBackend()
    backend.active_session = {
        "id": "session-A",
        "state": "active",
        "baselineState": "configured",
        "baseline": {
            "headForward": 0.2,
            "headDrop": 0.3,
            "shoulderRoll": 0.1,
            "sampleCount": 30,
        },
    }
    try:
        daemon = make_daemon(backend)
        status, session = daemon.poll_session()
        daemon.update_session_state(status, session)
        assert daemon.session_id == "session-A"
        assert daemon.state == STATE_MONITORING_ACTIVE

        # Switch to session B (unconfigured)
        backend.active_session = {
            "id": "session-B",
            "state": "active",
            "baselineState": "unconfigured",
            "baseline": None,
        }
        status, session = daemon.poll_session()
        daemon.update_session_state(status, session)

        assert daemon.session_id == "session-B"
        assert daemon.state == STATE_ATTACHED_UNCONFIGURED
        assert daemon.baseline is None
        assert daemon.rule is None
    finally:
        backend.close()


# ── Safety & Error Handling Tests ──────────────────────────────────────────


def test_no_violation_before_baseline():
    backend = MockBackend()
    backend.active_session = {
        "id": "session-201",
        "state": "active",
        "baselineState": "unconfigured",
        "baseline": None,
    }
    try:
        detector = SequenceDetector([_landmarks(_SLOUCHED)])
        daemon = make_daemon(backend, detector=detector)
        daemon.camera.open()
        status, session = daemon.poll_session()
        daemon.update_session_state(status, session)
        assert daemon.state == STATE_ATTACHED_UNCONFIGURED

        # Step frames with slouched posture
        for _ in range(5):
            daemon.step_frame()

        # No violation events should be sent
        assert backend.events == []
    finally:
        backend.close()


def test_no_stale_baseline_after_reset():
    backend = MockBackend()
    backend.active_session = {
        "id": "session-202",
        "state": "active",
        "baselineState": "configured",
        "baseline": {
            "headForward": 0.25,
            "headDrop": 0.35,
            "shoulderRoll": 0.15,
            "sampleCount": 30,
        },
    }
    detector = SequenceDetector([_landmarks(_SLOUCHED)])
    try:
        daemon = make_daemon(backend, detector=detector)
        daemon.camera.open()
        status, session = daemon.poll_session()
        daemon.update_session_state(status, session)
        assert daemon.state == STATE_MONITORING_ACTIVE

        # Reset baseline
        backend.active_session["baselineState"] = "unconfigured"
        status, session = daemon.poll_session()
        daemon.update_session_state(status, session)
        assert daemon.state == STATE_ATTACHED_UNCONFIGURED

        # Step frames with slouched posture post-reset
        for _ in range(5):
            daemon.step_frame()

        # No violation events
        assert backend.events == []
    finally:
        backend.close()


def test_failed_baseline_does_not_emit_baseline_captured():
    backend = MockBackend()
    backend.active_session = {
        "id": "session-203",
        "state": "active",
        "baselineState": "capturing",
        "baseline": None,
    }
    detector = FailingDetector()
    try:
        daemon = make_daemon(
            backend,
            detector=detector,
            baseline_min_samples=30,
            baseline_max_seconds=0.0,
        )
        daemon.camera.open()
        status, session = daemon.poll_session()
        daemon.update_session_state(status, session)

        # Baseline capture should fail cleanly without posting event
        assert daemon.state == STATE_ATTACHED_UNCONFIGURED
        assert [e for e in backend.events if e["type"] == EVENT_BASELINE_CAPTURED] == []
    finally:
        backend.close()


def test_backend_polling_failure_does_not_crash_daemon():
    backend = MockBackend()
    backend.active_session = {
        "id": "session-204",
        "state": "active",
        "baselineState": "configured",
        "baseline": {
            "headForward": 0.25,
            "headDrop": 0.35,
            "shoulderRoll": 0.15,
            "sampleCount": 30,
        },
    }
    try:
        daemon = make_daemon(backend)
        status, session = daemon.poll_session()
        daemon.update_session_state(status, session)
        assert daemon.state == STATE_MONITORING_ACTIVE

        # Simulate backend outage
        backend.sessions_status = 500

        status, session = daemon.poll_session()
        assert status == "error"
        daemon.update_session_state(status, session)

        # Daemon retains state and doesn't crash
        assert daemon.state == STATE_MONITORING_ACTIVE
        assert daemon.backend_available is False

        # Recover backend
        backend.sessions_status = 200
        status, session = daemon.poll_session()
        assert status == "ok"
        daemon.update_session_state(status, session)
        assert daemon.backend_available is True
    finally:
        backend.close()


def test_shutdown_releases_camera():
    backend = MockBackend()
    camera = FakeCamera()
    detector = SequenceDetector([_landmarks(_UPRIGHT)])
    try:
        daemon = make_daemon(backend, camera=camera, detector=detector)
        camera.open()
        assert camera.is_open
        daemon.close()
        assert camera.released
        assert detector.closed
    finally:
        backend.close()


# ── Integration Tests ────────────────────────────────────────────────────────


def test_monitoring_active_slouch_sequence_produces_violation_event():
    backend = MockBackend()
    backend.active_session = {
        "id": "session-301",
        "state": "active",
        "baselineState": "configured",
        "baseline": {
            "headForward": 0.10,
            "headDrop": 0.10,
            "shoulderRoll": 0.10,
            "sampleCount": 30,
        },
    }
    # Monotonic clock ticks 1s per call; slouch duration threshold is default 2.0s
    detector = SequenceDetector(
        [_landmarks(_UPRIGHT), _landmarks(_SLOUCHED), _landmarks(_SLOUCHED), _landmarks(_SLOUCHED)]
    )
    try:
        daemon = make_daemon(backend, detector=detector)
        daemon.camera.open()

        status, session = daemon.poll_session()
        daemon.update_session_state(status, session)
        assert daemon.state == STATE_MONITORING_ACTIVE

        for _ in range(4):
            daemon.step_frame()

        events = [e for e in backend.events if e["type"] == EVENT_SLOUCH_VIOLATION]
        assert len(events) == 1
        assert events[0]["sessionId"] == "session-301"
    finally:
        backend.close()
