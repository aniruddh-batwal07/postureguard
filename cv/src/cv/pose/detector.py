"""MediaPipe Pose detector wrapper for posture detection.

Uses the MediaPipe Tasks API (PoseLandmarker) which replaced the legacy
``mediapipe.solutions`` API in MediaPipe 1.x. The pose landmarker model
is downloaded on first use if it is not present locally.
"""

from __future__ import annotations

import os
import time
import urllib.request
from dataclasses import dataclass
import math
from typing import Any

import numpy as np

# Official MediaPipe model (float16, lite). Used unless overridden.
DEFAULT_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/"
    "pose_landmarker/pose_landmarker_lite/float16/1/"
    "pose_landmarker_lite.task"
)

MODEL_FILENAME = "pose_landmarker_lite.task"


class PoseDetectionError(RuntimeError):
    """Raised when pose detection fails or produces invalid results."""


# Landmarks required for a valid posture sample with a laptop webcam.
#
# Only upper-body landmarks that are reliably visible with a typical laptop
# camera are required. The hips are deliberately NOT required: with a laptop
# webcam the user's hips are frequently below the camera frame, so requiring
# them makes calibration fail even though the upper body is perfectly visible.
REQUIRED_LANDMARKS = ("NOSE", "LEFT_SHOULDER", "RIGHT_SHOULDER")


@dataclass(frozen=True)
class PoseLandmarks:
    """Normalized pose landmarks from MediaPipe Pose.

    Coordinates are in [0, 1] range relative to image dimensions.
    Only includes landmarks whose visibility exceeds the detector's configured
    threshold (see ``PoseDetector.landmark_visibility_threshold``).
    """

    landmarks: dict[str, tuple[float, float, float]]
    visibility: dict[str, float]
    image_width: int
    image_height: int

    @property
    def is_valid(self) -> bool:
        """Check that the required upper-body landmarks are present.

        A sample is only valid if the nose and both shoulders are present
        (which implies they met the configured visibility threshold) and all of
        their values are finite. Additional landmarks such as hips, elbows, and
        wrists are never required.
        """
        return all(
            name in self.landmarks
            and all(math.isfinite(value) for value in self.landmarks[name])
            and math.isfinite(self.visibility.get(name, float("nan")))
            for name in REQUIRED_LANDMARKS
        )


# MediaPipe Pose landmark names for key body points (matching PoseLandmarker
# index order: 0=NOSE, 11/12=shoulders, 23/24=hips, ...)
LANDMARK_NAMES = {
    0: "NOSE",
    11: "LEFT_SHOULDER",
    12: "RIGHT_SHOULDER",
    13: "LEFT_ELBOW",
    14: "RIGHT_ELBOW",
    15: "LEFT_WRIST",
    16: "RIGHT_WRIST",
    23: "LEFT_HIP",
    24: "RIGHT_HIP",
    25: "LEFT_KNEE",
    26: "RIGHT_KNEE",
    27: "LEFT_ANKLE",
    28: "RIGHT_ANKLE",
}


def ensure_model(model_path: str, url: str = DEFAULT_MODEL_URL) -> str:
    """Ensure the pose landmarker model exists locally, downloading if needed.

    Args:
        model_path: local path the model should live at.
        url: source URL to download from if the file is missing.

    Returns:
        The path to the model file.

    Raises:
        PoseDetectionError: if the model cannot be obtained.
    """
    path = os.path.abspath(model_path)
    if os.path.exists(path):
        return path

    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)

    try:
        urllib.request.urlretrieve(url, path)
    except Exception as err:
        raise PoseDetectionError(f"could not download pose model to {path}: {err}") from err

    if not os.path.exists(path):
        raise PoseDetectionError(f"pose model missing at {path}")
    return path


class PoseDetector:
    """MediaPipe PoseLandmarker wrapper for posture analysis."""

    def __init__(
        self,
        min_detection_confidence: float = 0.5,
        min_tracking_confidence: float = 0.5,
        landmark_visibility_threshold: float = 0.5,
        model_path: str = "models/" + MODEL_FILENAME,
    ) -> None:
        self._min_detection_confidence = min_detection_confidence
        self._min_tracking_confidence = min_tracking_confidence
        self._landmark_visibility_threshold = landmark_visibility_threshold
        self._model_path = model_path
        self._landmarker: Any | None = None
        self._last_timestamp_ms = 0

    @property
    def landmark_visibility_threshold(self) -> float:
        """Per-landmark visibility required for a landmark to be kept."""
        return self._landmark_visibility_threshold

    def initialize(self) -> None:
        """Initialize the MediaPipe PoseLandmarker model."""
        try:
            from mediapipe.tasks import python as mp_python
            from mediapipe.tasks.python import vision
        except ImportError as err:
            raise PoseDetectionError(
                "MediaPipe not installed. Run: uv sync (or pip install mediapipe)"
            ) from err

        try:
            model_asset = ensure_model(self._model_path)
            base_options = mp_python.BaseOptions(model_asset_path=model_asset)
            options = vision.PoseLandmarkerOptions(
                base_options=base_options,
                running_mode=vision.RunningMode.VIDEO,
                num_poses=1,
                min_pose_detection_confidence=self._min_detection_confidence,
                min_tracking_confidence=self._min_tracking_confidence,
            )
            self._landmarker = vision.PoseLandmarker.create_from_options(options)
            self._last_timestamp_ms = 0
        except PoseDetectionError:
            raise
        except Exception as err:
            raise PoseDetectionError(f"failed to initialize MediaPipe Pose: {err}") from err

    def _increment_timestamp(self) -> int:
        ts = max(int(time.monotonic() * 1000), self._last_timestamp_ms + 1)
        self._last_timestamp_ms = ts
        return ts

    def detect(self, frame: np.ndarray) -> PoseLandmarks | None:
        """Detect pose landmarks in a single frame.

        Args:
            frame: BGR image as numpy array (OpenCV format).

        Returns:
            PoseLandmarks if pose detected with sufficient confidence,
            None if no pose detected or landmarks are invalid.
        """
        if self._landmarker is None:
            raise PoseDetectionError("PoseDetector not initialized. Call initialize() first.")

        if frame is None or frame.size == 0:
            return None

        try:
            from mediapipe import Image, ImageFormat
            from mediapipe.tasks.python import vision

            rgb_frame = frame[:, :, ::-1].copy()
            image = Image(image_format=ImageFormat.SRGB, data=rgb_frame)
            timestamp_ms = self._increment_timestamp()
            results = self._landmarker.detect_for_video(image, timestamp_ms)

            if not results.pose_landmarks:
                return None

            return self._extract_landmarks(
                results.pose_landmarks[0], frame.shape[1], frame.shape[0]
            )
        except Exception:
            # On any processing error, return None rather than crashing
            return None

    def _extract_landmarks(
        self, pose_landmarks: Any, image_width: int, image_height: int
    ) -> PoseLandmarks:
        """Extract and filter landmarks from the PoseLandmarker result."""
        landmarks = {}
        visibility = {}

        for idx, name in LANDMARK_NAMES.items():
            if idx < len(pose_landmarks):
                lm = pose_landmarks[idx]
                # Only include landmarks with sufficient visibility
                values = (float(lm.x), float(lm.y), float(lm.z), float(lm.visibility))
                if (
                    values[3] > self._landmark_visibility_threshold
                    and all(math.isfinite(value) for value in values)
                ):
                    landmarks[name] = values[:3]
                    visibility[name] = values[3]

        return PoseLandmarks(
            landmarks=landmarks,
            visibility=visibility,
            image_width=image_width,
            image_height=image_height,
        )

    def close(self) -> None:
        """Release MediaPipe resources."""
        if self._landmarker is not None:
            try:
                self._landmarker.close()
            except Exception:
                pass
            self._landmarker = None

    def __enter__(self) -> "PoseDetector":
        self.initialize()
        return self

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        self.close()