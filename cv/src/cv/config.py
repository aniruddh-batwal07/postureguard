"""Shared, environment-driven configuration for the CV service.

Values mirror backend/src/config.js and .env.example. Environment variables
are read directly; the optional root .env file can be loaded by the caller
(e.g. ``set -a; source .env; set +a``). No external dependency.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    host: str = "127.0.0.1"
    web_port: int = 5173
    backend_port: int = 4000
    mongo_uri: str = "mongodb://127.0.0.1:27017/postureguard"
    camera_index: int = 0
    serial_port: str = "/dev/ttyACM0"

    # M2.3 slouch detection rules. Deviating from the session baseline beyond
    # slouch_threshold (magnitude) must be sustained for slouch_duration_seconds
    # before a slouch_violation fires; returning within range must then hold for
    # correction_duration_seconds before a correction_requested event fires.
    slouch_threshold: float = 0.15
    slouch_duration_seconds: float = 2.0
    correction_duration_seconds: float = 2.0

    @property
    def backend_url(self) -> str:
        return f"http://{self.host}:{self.backend_port}"

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            host=os.environ.get("HOST", cls.host),
            web_port=int(os.environ.get("WEB_PORT", cls.web_port)),  # type: ignore[arg-type]
            backend_port=int(os.environ.get("BACKEND_PORT", cls.backend_port)),  # type: ignore[arg-type]
            mongo_uri=os.environ.get("MONGODB_URI", cls.mongo_uri),
            camera_index=int(os.environ.get("CAMERA_INDEX", cls.camera_index)),  # type: ignore[arg-type]
            serial_port=os.environ.get("ARDUINO_SERIAL_PORT", cls.serial_port),
            slouch_threshold=float(os.environ.get("CV_SLOUCH_THRESHOLD", cls.slouch_threshold)),  # type: ignore[arg-type]
            slouch_duration_seconds=float(  # type: ignore[arg-type]
                os.environ.get("CV_SLOUCH_DURATION_SECONDS", cls.slouch_duration_seconds)
            ),
            correction_duration_seconds=float(  # type: ignore[arg-type]
                os.environ.get("CV_CORRECTION_DURATION_SECONDS", cls.correction_duration_seconds)
            ),
        )