# PostureGuard CV service

Python computer vision service (src layout, package `cv`).

**Status:** Milestone M0.1 scaffold only. Camera capture, MediaPipe Pose,
YOLOv8 Nano + MediaPipe Hands, debounce rules, and the events client are NOT
implemented yet (see `docs/development-plan.md` Phase 2).

Modules (from architecture §6):

- `camera/` — webcam capture
- `pose/` — MediaPipe Pose baseline + deviation
- `phone/` — YOLOv8 Nano + MediaPipe Hands
- `rules/` — debounce/timer violations
- `events/` — HTTP client to backend

Development install:

```sh
pip install -e ./cv
python -m cv
```

Dependencies for detection (MediaPipe, Ultralytics, OpenCV) are intentionally
added in Phase 2, when they are actually needed.