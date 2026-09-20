"""Development-only webcam preview with detected landmark overlay.

This is a developer/debug aid for seeing what the camera sees and whether pose
landmarks are being detected during calibration. It is deliberately separate
from the production dashboard (a web app): it never ships state to the backend
and is only active while a local preview renderer is explicitly created.

It degrades to a no-op (``enabled`` False) if OpenCV cannot create a window
(e.g. a headless environment), so importing or constructing it is always safe.
"""

from __future__ import annotations

from typing import Any, Callable

import cv2

from cv.pose.detector import PoseLandmarks

# Landmark draw colors (BGR). Required upper-body landmarks are highlighted;
# everything else (elbows, wrists, hips, ...) is drawn faintly for context.
_NOSE_COLOR = (0, 255, 0)
_SHOULDER_COLOR = (255, 128, 0)
_OTHER_COLOR = (128, 128, 128)
_TEXT_COLOR = (0, 255, 0)


class PreviewRenderer:
    """Renders camera frames to a debug window, optionally drawing landmarks."""

    def __init__(
        self,
        window_name: str = "PostureGuard CV (dev preview)",
        named_window: Callable[[str], Any] = cv2.namedWindow,
        show: Callable[[str, Any], Any] = cv2.imshow,
        poll: Callable[[int], Any] = cv2.waitKey,
    ) -> None:
        self._window_name = window_name
        self._show = show
        self._poll = poll
        self._enabled = False
        try:
            named_window(window_name)
            self._enabled = True
        except Exception:
            self._enabled = False

    @property
    def enabled(self) -> bool:
        return self._enabled

    def render(
        self,
        frame: Any,
        landmarks: PoseLandmarks | None = None,
        status: str | None = None,
    ) -> int | None:
        """Draw one annotated frame to the preview window. Returns key code if key pressed."""
        if not self._enabled or frame is None:
            return None
        try:
            if hasattr(cv2, "getWindowProperty") and hasattr(cv2, "WND_PROP_VISIBLE"):
                prop = cv2.getWindowProperty(self._window_name, cv2.WND_PROP_VISIBLE)
                if prop < 0:
                    self.close()
                    return None

            annotated = frame.copy()
            if landmarks is not None:
                self._draw_landmarks(annotated, landmarks)
            if status:
                cv2.putText(
                    annotated,
                    status,
                    (8, 26),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    _TEXT_COLOR,
                    2,
                    cv2.LINE_AA,
                )
            self._show(self._window_name, annotated)
            key = self._poll(1)
            return key if key != -1 else None
        except Exception:
            self._enabled = False
            return None

    def close(self) -> None:
        """Destroy the preview window. Safe to call multiple times."""
        if self._enabled:
            try:
                cv2.destroyWindow(self._window_name)
            except Exception:
                pass
            self._enabled = False

    def _draw_landmarks(self, frame: Any, landmarks: PoseLandmarks) -> None:
        height, width = frame.shape[:2]
        shoulder_points = {}

        for name, values in landmarks.landmarks.items():
            x = int(round(values[0] * width))
            y = int(round(values[1] * height))
            if name == "NOSE":
                color, radius = _NOSE_COLOR, 6
            elif name in ("LEFT_SHOULDER", "RIGHT_SHOULDER"):
                color, radius = _SHOULDER_COLOR, 8
                shoulder_points[name] = (x, y)
            else:
                color, radius = _OTHER_COLOR, 3
            cv2.circle(frame, (x, y), radius, color, -1, cv2.LINE_AA)

        if len(shoulder_points) == 2:
            left = shoulder_points.get("LEFT_SHOULDER")
            right = shoulder_points.get("RIGHT_SHOULDER")
            if left is not None and right is not None:
                cv2.line(frame, left, right, _SHOULDER_COLOR, 2, cv2.LINE_AA)