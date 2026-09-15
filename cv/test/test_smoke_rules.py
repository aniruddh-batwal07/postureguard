"""Manual real-camera M2.3 slouch/correction demonstration.

This test must be run on the Windows host with a physical webcam and a HUMAN at
the camera. It is NOT designed for CI — it opens the real camera, runs MediaPipe,
and waits for the operator to slouch and then correct their posture.

Usage (Windows PowerShell, from the cv/ directory):

    & "C:\\Users\\<you>\\.venvs\\postureguard-cv\\Scripts\\python.exe" `
        -m pytest test/test_smoke_rules.py -m smoke -v -s

Flow:
  1. Sit upright at a natural distance from the webcam (head + both shoulders
     visible). A short baseline (5 samples) is captured.
  2. Follow the on-screen prompt: SLOUCH NOW and HOLD — after the slouch is
     sustained for ``slouch_duration_seconds`` a ``slouch_violation`` must print.
  3. Follow the prompt: RETURN UPRIGHT and HOLD — after the recovery is sustained
     for ``correction_duration_seconds`` a ``correction_requested`` must print.

The rule parameters come from the shared ``Config`` (i.e. the ``CV_*`` env vars
in .env.example) so this test exercises the real configuration path.
"""

from __future__ import annotations

import time

import pytest

from cv.camera import Camera, CameraError
from cv.config import Config
from cv.pose import (
    PoseDetectionError,
    PoseDetector,
    calculate_deviation,
    capture_baseline,
    extract_posture_measurement,
)
from cv.rules import (
    EVENT_CORRECTION_REQUESTED,
    EVENT_SLOUCH_VIOLATION,
    SlouchRule,
)

_WARMUP_FRAMES = 10
_WARMUP_SLEEP = 0.05

_MIN_SAMPLES = 5
_BASELINE_TIMEOUT = 20.0
_PHASE_TIMEOUT = 30.0  # seconds granted to slouch / recover on cue

_LAST_STATUS = {"t": 0.0}


def _warm_up_camera(camera: Camera) -> None:
    for _ in range(_WARMUP_FRAMES):
        try:
            camera.read()
        except CameraError:
            break
        time.sleep(_WARMUP_SLEEP)


def _status(
    rule: SlouchRule,
    magnitude: float | None,
    phase_start: float,
    elapsed: float,
) -> None:
    """Print one progress line per ~0.5s so the operator sees live posture state.

    Shows the classified condition, the deviation magnitude, and how long the
    current bad/good run has been sustained vs. the required duration.
    """
    now = time.monotonic()
    if now - _LAST_STATUS["t"] < 0.5:
        return
    _LAST_STATUS["t"] = now

    if rule.slouch_active and rule.correction_since is not None:
        progress = now - rule.correction_since
        need = rule.correction_duration_seconds
        state = f"recovering {progress:.1f}s/{need:.1f}s"
    elif rule.slouch_since is not None:
        progress = now - rule.slouch_since
        need = rule.slouch_duration_seconds
        state = f"slouching {progress:.1f}s/{need:.1f}s"
    else:
        state = "upright"

    mag = f"{magnitude:.3f}" if magnitude is not None else "n/a"
    print(
        f"[smoke] t={elapsed:4.1f}s condition={rule.condition:7s} "
        f"magnitude={mag} -> {state}",
        flush=True,
    )


def _monitor_until(
    camera: Camera,
    detector: PoseDetector,
    rule: SlouchRule,
    target_event: str,
    guidance: str,
    timeout: float = _PHASE_TIMEOUT,
) -> tuple[list[str], int]:
    """Read live frames until ``target_event`` fires or the timeout elapses.

    Returns (emitted_events, frames_read).
    """
    print("=" * 70, flush=True)
    print(f">>> {guidance} <<<", flush=True)
    print(f">>> Waiting for `{target_event}` (timeout {timeout:.0f}s) ... <<<", flush=True)
    print("=" * 70, flush=True)

    events: list[str] = []
    start = time.monotonic()
    frames = 0
    while time.monotonic() - start < timeout:
        frame = camera.read()
        frames += 1
        magnitude: float | None = None
        measurement = None
        landmarks = detector.detect(frame)
        if landmarks is not None and landmarks.is_valid:
            measurement = extract_posture_measurement(landmarks)
            if measurement is not None:
                magnitude = calculate_deviation(
                    measurement, rule.baseline
                ).magnitude()
        events.extend(rule.update(measurement, time.monotonic()))
        _status(rule, magnitude, start, time.monotonic() - start)
        if target_event in events:
            return events, frames
        time.sleep(0.05)

    return events, frames


@pytest.mark.smoke
class TestManualSlouchDemonstration:
    """Manual demo: baseline -> slouch -> violation -> upright -> correction."""

    def test_slouch_violation_and_correction_flow(self):
        config = Config()
        camera = Camera(config.camera_index)
        detector = PoseDetector(min_detection_confidence=0.5)
        try:
            camera.open()
            detector.initialize()
            _warm_up_camera(camera)

            print("=" * 70, flush=True)
            print("STEP 1/3 — SIT UPRIGHT at a natural distance from the webcam.", flush=True)
            print("Head and BOTH shoulders must stay visible. Hold still.", flush=True)
            print("=" * 70, flush=True)
            time.sleep(2.0)

            baseline = capture_baseline(
                camera,
                detector,
                min_samples=_MIN_SAMPLES,
                max_seconds=_BASELINE_TIMEOUT,
                progress=lambda c, r: print(f"[smoke] Baseline: {c}/{r} valid samples", flush=True),
            )
            print(
                f"[smoke] baseline OK ({baseline.sample_count} samples): "
                f"head_forward={baseline.head_forward:.3f} "
                f"head_drop={baseline.head_drop:.3f} "
                f"shoulder_roll={baseline.shoulder_roll:.3f}",
                flush=True,
            )

            rule = SlouchRule(
                baseline.to_measurement(),
                slouch_threshold=config.slouch_threshold,
                slouch_duration_seconds=config.slouch_duration_seconds,
                correction_duration_seconds=config.correction_duration_seconds,
            )
            print(
                f"[smoke] rule: threshold={config.slouch_threshold:.2f} "
                f"slouch_duration={config.slouch_duration_seconds:.1f}s "
                f"correction_duration={config.correction_duration_seconds:.1f}s",
                flush=True,
            )
            _LAST_STATUS["t"] = 0.0

            # Phase 2 — operator slouches and holds.
            events, _ = _monitor_until(
                camera,
                detector,
                rule,
                EVENT_SLOUCH_VIOLATION,
                "SLOUCH NOW: lean forward/down and HOLD a clearly slouched posture",
            )
            assert EVENT_SLOUCH_VIOLATION in events, (
                "slouch_violation never fired — did you hold the slouch for "
                f"{config.slouch_duration_seconds:.1f}s within the timeout?"
            )
            assert events.count(EVENT_SLOUCH_VIOLATION) == 1
            assert rule.slouch_active
            print(f"[smoke] OK: {EVENT_SLOUCH_VIOLATION} fired after a sustained slouch", flush=True)

            # Phase 3 — operator returns upright and holds.
            events2, _ = _monitor_until(
                camera,
                detector,
                rule,
                EVENT_CORRECTION_REQUESTED,
                "RETURN UPRIGHT: straighten up and HOLD a good posture",
            )
            assert EVENT_CORRECTION_REQUESTED in events2, (
                "correction_requested never fired — did you return upright and hold "
                f"for {config.correction_duration_seconds:.1f}s?"
            )
            assert events2.count(EVENT_CORRECTION_REQUESTED) == 1
            assert not rule.slouch_active
            full = events + events2
            print(
                f"[smoke] OK: {EVENT_CORRECTION_REQUESTED} fired after a sustained recovery",
                flush=True,
            )
            print(
                f"[smoke] full event sequence: {full}",
                flush=True,
            )
            assert full == [EVENT_SLOUCH_VIOLATION, EVENT_CORRECTION_REQUESTED]
        except PoseDetectionError as err:
            pytest.fail(f"MediaPipe pose detection failed: {err}")  # type: ignore[misc]
        finally:
            detector.close()
            camera.release()