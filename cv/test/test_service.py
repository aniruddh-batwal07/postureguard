import numpy as np
import pytest

from cv.__main__ import EVENT_BASELINE_CAPTURED, resolve_active_session, run
from cv.config import Config
from cv.events import EventClient
from cv.pose import BaselineCaptureError, PoseLandmarks
from cv.rules import EVENT_CORRECTION_REQUESTED, EVENT_SLOUCH_VIOLATION
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


def client_for(backend):
    return EventClient(backend.base_url)


class FailingDetector:
    def initialize(self):
        return None

    def detect(self, frame):
        return None

    def close(self):
        return None


def test_run_opens_camera_resolves_session_and_releases():
    backend = MockBackend()
    try:
        camera = FakeCamera()
        session_id = run(
            Config(), client_for(backend), camera,
            max_frames=3, frame_delay=0, preview_enabled=False,
        )
        assert session_id == "session-1"
        assert backend.events == []
        assert camera.open_calls == 1 and camera.released
        assert camera.read_count == 4
    finally:
        backend.close()


def test_run_reuses_existing_active_session():
    backend = MockBackend()
    backend.active_session = {"id": "pre-existing", "state": "monitoring"}
    try:
        camera = FakeCamera()
        session_id = run(
            Config(), client_for(backend), camera,
            max_frames=1, frame_delay=0, preview_enabled=False,
        )
        assert session_id == "pre-existing"
        posted = [req[1] for req in backend.requests]
        assert "/api/sessions" not in posted
        assert camera.released
    finally:
        backend.close()


def test_resolve_active_session_creates_when_none_exists():
    backend = MockBackend()
    try:
        session = resolve_active_session(client_for(backend))
        assert session["id"] == "session-1"
    finally:
        backend.close()


def test_failed_pose_baseline_forwards_no_events():
    backend = MockBackend()
    try:
        camera = FakeCamera()
        detector = FailingDetector()
        with pytest.raises(BaselineCaptureError, match="valid samples"):
            run(
                Config(),
                client_for(backend),
                camera,
                max_frames=1,
                frame_delay=0,
                detector=detector,
                baseline_min_samples=1,
                baseline_max_seconds=0,
                preview_enabled=False,
            )
        assert backend.events == []
        assert camera.released
        assert camera.open_calls == 1
    finally:
        backend.close()


def test_run_reports_calibration_progress_on_stdout(capsys):
    backend = MockBackend()
    try:
        camera = FakeCamera()
        run(
            Config(),
            client_for(backend),
            camera,
            max_frames=1,
            frame_delay=0,
            detector=FailingDetector(),
            baseline_min_samples=30,
            baseline_max_seconds=0,
            preview_enabled=False,
        )
    except BaselineCaptureError:
        pass
    finally:
        backend.close()
    output = capsys.readouterr().out
    assert "Baseline: 0/30 valid samples" in output


def test_run_releases_camera_when_detector_initialization_fails():
    backend = MockBackend()
    try:
        camera = FakeCamera()

        class BrokenDetector:
            def initialize(self):
                raise RuntimeError("model missing")

        with pytest.raises(RuntimeError, match="model missing"):
            run(Config(), client_for(backend), camera, max_frames=1, detector=BrokenDetector(), preview_enabled=False)
        assert camera.released
    finally:
        backend.close()


# ── M2.3: slouch-rule wiring in the monitoring loop ──────────────────────────


# Upright upper-body landmark set (identical posture) and a slouched one
# (head pushed forward/down), both finite and above the unit visibility bar.
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
    """Returns one landmark result per call, cycling through ``results``."""

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
    """Returns 1, 2, 3, ... on successive calls (one per monitoring frame)."""

    def __init__(self):
        self.t = 0.0

    def __call__(self):
        self.t += 1.0
        return self.t


def test_run_loop_forwards_sustained_slouch_event(capsys):
    backend = MockBackend()
    try:
        camera = FakeCamera()
        # Baseline consumes the first (upright) landmark; the monitoring loop
        # then sees the slouched posture for the following frames.
        detector = SequenceDetector(
            [_landmarks(_UPRIGHT), _landmarks(_SLOUCHED), _landmarks(_SLOUCHED), _landmarks(_SLOUCHED)]
        )
        clock = FakeMonotonic()
        session_id = run(
            Config(),
            client_for(backend),
            camera,
            max_frames=5,
            frame_delay=0,
            detector=detector,
            baseline_min_samples=1,
            baseline_max_seconds=1.0,
            preview_enabled=False,
            time_fn=clock,
        )
        # Exactly one baseline_captured event followed by the slouch violation.
        assert session_id == "session-1"
        assert [e["type"] for e in backend.events] == [
            EVENT_BASELINE_CAPTURED,
            EVENT_SLOUCH_VIOLATION,
        ]
        assert all(e["sessionId"] == "session-1" for e in backend.events)
        assert f"event sent: {EVENT_SLOUCH_VIOLATION}" in capsys.readouterr().out
    finally:
        backend.close()


def test_run_loop_forwards_baseline_captured_after_successful_capture():
    backend = MockBackend()
    try:
        camera = FakeCamera()
        detector = SequenceDetector([_landmarks(_UPRIGHT)])
        run(
            Config(),
            client_for(backend),
            camera,
            max_frames=1,
            frame_delay=0,
            detector=detector,
            baseline_min_samples=1,
            baseline_max_seconds=1.0,
            preview_enabled=False,
            time_fn=FakeMonotonic(),
        )
        assert [e["type"] for e in backend.events] == [EVENT_BASELINE_CAPTURED]
        assert backend.events[0]["sessionId"] == "session-1"
    finally:
        backend.close()


def test_run_loop_does_not_forward_violation_for_upright_posture(capsys):
    backend = MockBackend()
    try:
        camera = FakeCamera()
        detector = SequenceDetector(
            [_landmarks(_UPRIGHT), _landmarks(_UPRIGHT), _landmarks(_UPRIGHT)]
        )
        run(
            Config(),
            client_for(backend),
            camera,
            max_frames=3,
            frame_delay=0,
            detector=detector,
            baseline_min_samples=1,
            baseline_max_seconds=1.0,
            preview_enabled=False,
            time_fn=FakeMonotonic(),
        )
        # Baseline captured, no violation: exactly the baseline event.
        assert [e["type"] for e in backend.events] == [EVENT_BASELINE_CAPTURED]
        output = capsys.readouterr().out
        assert f"event sent: {EVENT_SLOUCH_VIOLATION}" not in output
    finally:
        backend.close()


def test_run_loop_forwards_correction_after_recovery():
    backend = MockBackend()
    try:
        camera = FakeCamera()
        # Baseline consumes one upright sample, then the loop sees slouch (2s,
        # violation), then upright (2s, correction) back-to-back.
        detector = SequenceDetector(
            [
                _landmarks(_UPRIGHT),
                _landmarks(_SLOUCHED),
                _landmarks(_SLOUCHED),
                _landmarks(_SLOUCHED),
                _landmarks(_UPRIGHT),
                _landmarks(_UPRIGHT),
            ]
        )
        run(
            Config(),
            client_for(backend),
            camera,
            max_frames=7,
            frame_delay=0,
            detector=detector,
            baseline_min_samples=1,
            baseline_max_seconds=1.0,
            preview_enabled=False,
            time_fn=FakeMonotonic(),
        )
        # Baseline, then violation, then correction — in order.
        assert [e["type"] for e in backend.events] == [
            EVENT_BASELINE_CAPTURED,
            EVENT_SLOUCH_VIOLATION,
            EVENT_CORRECTION_REQUESTED,
        ]
    finally:
        backend.close()


def test_run_loop_survives_forwarding_failure(capsys):
    backend = MockBackend()
    backend.events_status = 500
    try:
        camera = FakeCamera()
        detector = SequenceDetector(
            [_landmarks(_UPRIGHT), _landmarks(_SLOUCHED), _landmarks(_SLOUCHED), _landmarks(_SLOUCHED)]
        )
        session_id = run(
            Config(),
            client_for(backend),
            camera,
            max_frames=5,
            frame_delay=0,
            detector=detector,
            baseline_min_samples=1,
            baseline_max_seconds=1.0,
            preview_enabled=False,
            time_fn=FakeMonotonic(),
        )
        assert session_id == "session-1"
        assert camera.released
        assert "failed to forward event 'slouch_violation'" in capsys.readouterr().err
    finally:
        backend.close()