import numpy as np
import pytest

from cv.__main__ import resolve_active_session, run
from cv.config import Config
from cv.events import EventClient
from cv.pose import BaselineCaptureError
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


def test_run_opens_camera_posts_initial_events_and_releases():
    backend = MockBackend()
    try:
        camera = FakeCamera()
        session_id = run(
            Config(), client_for(backend), camera,
            max_frames=3, frame_delay=0, preview_enabled=False,
        )
        assert session_id == "session-1"
        assert [e["type"] for e in backend.events] == ["session_start", "baseline_captured"]
        assert all(e["sessionId"] == session_id for e in backend.events)
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


def test_failed_pose_baseline_does_not_emit_baseline_event():
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
        assert [event["type"] for event in backend.events] == ["session_start"]
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