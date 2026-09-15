"""Posture detection and baseline capture using MediaPipe Pose.

This module provides:
- PoseDetector: MediaPipe Pose wrapper for landmark extraction
- PostureMeasurement: posture feature representation from landmarks
- PostureBaseline / BaselineCollector: per-session baseline computation
- PostureDeviation: deviation of current posture from baseline
"""

from cv.pose.baseline import BaselineCollector, BaselineError, PostureBaseline, compute_baseline
from cv.pose.capture import BaselineCaptureError, baseline_capture_payload, capture_baseline
from cv.pose.detector import PoseDetectionError, PoseDetector, PoseLandmarks
from cv.pose.posture import (
    PostureDeviation,
    PostureMeasurement,
    calculate_deviation,
    extract_posture_measurement,
)

__all__ = [
    "BaselineCaptureError",
    "BaselineCollector",
    "BaselineError",
    "PoseDetectionError",
    "PoseDetector",
    "PoseLandmarks",
    "PostureBaseline",
    "PostureDeviation",
    "PostureMeasurement",
    "baseline_capture_payload",
    "calculate_deviation",
    "capture_baseline",
    "compute_baseline",
    "extract_posture_measurement",
]