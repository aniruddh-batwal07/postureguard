# PostureGuard CV service

Python computer vision service (src layout, package `cv`). Runs **natively on
the Windows host** so it has direct access to the physical webcam; it talks to
the Node.js/Express backend (running in WSL Ubuntu) over `localhost` (WSL2
localhost forwarding). See `docs/architecture.md` §1 and §3.

**Status:** Milestone M2.3 — service skeleton, camera capture, MediaPipe Pose
landmarks, structured posture measurements, per-session baseline capture, and a
**sustained-condition slouch/debounce rule** are implemented. A valid posture
sample requires only the upper-body landmarks that are reliably visible on a
laptop webcam — **nose + left/right shoulder**; the hips are NOT required (they
are often below the camera frame). After calibration, live measurements are
compared against the session baseline; a deviation beyond
`CV_SLOUCH_THRESHOLD` sustained for `CV_SLOUCH_DURATION_SECONDS` emits
`slouch_violation`, and returning within range for
`CV_CORRECTION_DURATION_SECONDS` emits `correction_requested`. Events are
currently printed by the service; forwarding them to the backend is a later
Phase 3 milestone. YOLOv8 Nano + MediaPipe Hands remain Phase 2.4.

Modules (from architecture §6):

- `camera/` — webcam capture (OpenCV)
- `pose/` — MediaPipe Pose landmark detection, upper-body posture measurement,
  and baseline capture (Phase 2.2)
- `debug/` — development-only webcam preview with landmark overlay (separate
  from the production dashboard)
- `phone/` — YOLOv8 Nano + MediaPipe Hands (Phase 2.4)
- `rules/` — debounce/timer violations (Phase 2.3): `SlouchRule`, a pure,
  deterministic state machine (inject timestamps; no camera/MediaPipe/backend
  imports) that turns a measurement stream into `slouch_violation` /
  `correction_requested` events after the configured sustained durations
- `events/` — HTTP client to backend

## Development

The project is managed with `uv` (`pyproject.toml` + `uv.lock`).

The virtual environment **must live on a Windows drive** (e.g.
`C:\Users\...\.venvs\postureguard-cv`), NOT inside the repo — if the repo is on
the WSL filesystem (`\\wsl.localhost\...`), numpy/cv2's native DLLs cannot load
reliably from a UNC path. Point uv at that venv with `UV_PROJECT_ENVIRONMENT`
(or use `cv/.env`, which documents the value):

```sh
# from the Windows host (PowerShell):
$env:UV_PROJECT_ENVIRONMENT = "C:\Users\<you>\.venvs\postureguard-cv"
uv sync                                  # create/refresh the Windows venv
uv run python -m cv      # open camera, post session_start/baseline_captured, capture until Ctrl+C
uv run pytest            # run the tests (fake camera + mock backend)
```

The service reads the shared environment variables (`host`, `backend_port`,
`camera_index`); see the repo-root `.env.example`. Connect to the backend over
`http://127.0.0.1:4000` — WSL2 forwards that port to the backend running in WSL.

MediaPipe Pose uses the checked-in `models/pose_landmarker_lite.task` asset.
The real-camera smoke test verifies camera 0, upper-body landmark extraction,
and baseline calculation on the Windows host:

```sh
uv run pytest test/test_smoke_camera.py -m smoke -v -s
# or, if uv is not on PATH:
& "C:\Users\<you>\.venvs\postureguard-cv\Scripts\python.exe" -m pytest test/test_smoke_camera.py -m smoke -v -s
```

During baseline calibration the service prints progress lines such as
`[cv] Baseline: 7/30 valid samples` and (by default) opens a development-only
preview window showing the camera feed with detected landmarks. Disable the
window with `python -m cv --no-preview`.

Once monitoring starts, sustained conditions are reported on stdout:

```
[cv] event: slouch_violation
[cv] event: correction_requested
```

The rule parameters come from the shared settings (`.env.example`):

| Env var                       | Default | Meaning                                            |
| ----------------------------- | ------- | -------------------------------------------------- |
| `CV_SLOUCH_THRESHOLD`         | 0.15    | deviation magnitude that counts as slouched        |
| `CV_SLOUCH_DURATION_SECONDS`  | 2.0     | sustained slouch before the violation fires        |
| `CV_CORRECTION_DURATION_SECONDS` | 2.0  | sustained recovery before the correction fires     |

The manual real-camera demonstration asks the operator to slouch and then
return upright, verifying both events fire after their sustained durations:

```sh
uv run pytest test/test_smoke_rules.py -m smoke -v -s
```