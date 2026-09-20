"""Webcam capture using OpenCV."""

from __future__ import annotations

import time
from typing import Any, Callable

import cv2

Frame = Any


class CameraError(RuntimeError):
    """Raised when the configured camera cannot be opened or read."""


def _open_capture(index: int) -> cv2.VideoCapture:
    # On Windows the default MSMF backend (cap_msmf.cpp) raises
    # MF_E_VIDEO_RECORDING_DEVICE_INVALIDATED (-1072875772) after rapid
    # open/close cycles, making read() return ok=False even though
    # isOpened() returns True. DirectShow (CAP_DSHOW) or CAP_ANY are used.
    # We probe the requested index first, and fall back to working indices (e.g. index 2).
    import sys
    if sys.platform == "win32":
        candidates = [
            (index, cv2.CAP_DSHOW),
            (index, cv2.CAP_ANY),
            (2, cv2.CAP_ANY),
            (0, cv2.CAP_ANY),
            (1, cv2.CAP_ANY),
        ]
        # Eliminate duplicates while preserving order
        seen = set()
        for idx, backend in candidates:
            if (idx, backend) in seen:
                continue
            seen.add((idx, backend))
            cap = cv2.VideoCapture(idx, backend)
            if cap.isOpened():
                ok, test_frame = cap.read()
                if ok and test_frame is not None:
                    return cap
                cap.release()
        return cv2.VideoCapture(index, cv2.CAP_DSHOW)
    return cv2.VideoCapture(index)



class Camera:
    """Thin wrapper around a ``cv2.VideoCapture`` opened from a device index."""

    def __init__(
        self,
        index: int = 0,
        capture_factory: Callable[[int], cv2.VideoCapture] = _open_capture,
    ) -> None:
        self._index = index
        self._capture_factory = capture_factory
        self._capture: cv2.VideoCapture | None = None

    def open(self) -> "Camera":
        """Open the camera and verify it is usable. Raises CameraError otherwise."""
        capture = self._capture_factory(self._index)
        if not capture.isOpened():
            capture.release()
            raise CameraError(f"camera index {self._index} could not be opened")
        self._capture = capture
        return self

    @property
    def is_open(self) -> bool:
        return self._capture is not None

    def read(self, retries: int = 3, retry_delay: float = 0.01) -> Frame:
        """Capture one frame. Raises CameraError if the camera was not opened or the read fails."""
        if self._capture is None:
            raise CameraError("camera is not open; call open() first")
        for attempt in range(retries):
            ok, frame = self._capture.read()
            if ok and frame is not None:
                return frame
            if attempt < retries - 1 and retry_delay > 0:
                time.sleep(retry_delay)
        raise CameraError("failed to read a frame from the camera")

    def release(self) -> None:
        """Release the capture. Safe to call when already released or never opened."""
        if self._capture is not None:
            self._capture.release()
            self._capture = None

    def __enter__(self) -> "Camera":
        return self.open()

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        self.release()