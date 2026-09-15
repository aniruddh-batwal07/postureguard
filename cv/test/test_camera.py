import numpy as np
import pytest

from cv.camera import Camera, CameraError


class FakeCapture:
    def __init__(self, index, opened=True, frames=None):
        self.index = index
        self.opened = opened
        self.frames = list(frames or [])
        self.calls = []
        self.released = False

    def isOpened(self):
        self.calls.append("isOpened")
        return self.opened

    def read(self):
        self.calls.append("read")
        if not self.frames:
            return False, None
        return True, self.frames.pop(0)

    def release(self):
        self.calls.append("release")
        self.released = True


def frames(n):
    return [np.zeros((32, 32, 3), dtype=np.uint8) for _ in range(n)]


def make_camera(index, capture):
    return Camera(index, capture_factory=lambda i: capture)


def test_open_uses_configured_index_and_returns_self():
    capture = FakeCapture(3, frames=frames(1))
    camera = make_camera(3, capture)
    opened = camera.open()
    assert opened is camera
    assert capture.index == 3
    assert "isOpened" in capture.calls
    assert camera.is_open


def test_open_releases_and_raises_when_camera_cannot_be_opened():
    capture = FakeCapture(0, opened=False)
    camera = make_camera(0, capture)
    with pytest.raises(CameraError, match="could not be opened"):
        camera.open()
    assert capture.released
    assert not camera.is_open


def test_read_returns_captured_frame():
    capture = FakeCapture(0, frames=frames(1))
    camera = make_camera(0, capture).open()
    frame = camera.read()
    assert frame.shape == (32, 32, 3)
    assert "read" in capture.calls


def test_read_raises_when_camera_not_open():
    camera = make_camera(0, FakeCapture(0))
    with pytest.raises(CameraError, match="not open"):
        camera.read()


def test_read_raises_when_frame_read_fails():
    capture = FakeCapture(0, frames=[])
    camera = make_camera(0, capture).open()
    with pytest.raises(CameraError, match="failed to read"):
        camera.read()


def test_release_is_idempotent():
    capture = FakeCapture(0, frames=frames(1))
    camera = make_camera(0, capture).open()
    camera.release()
    camera.release()
    assert capture.released
    assert not camera.is_open
    assert capture.calls.count("release") == 1


def test_context_manager_releases_camera():
    capture = FakeCapture(0, frames=frames(1))
    with make_camera(0, capture) as camera:
        assert camera.is_open
    assert capture.released
    assert not camera.is_open