# PostureGuard — Development Plan

- **Authoritative sources:** `docs/product-spec.md` (requirements) and `docs/architecture.md` (design)
- **Guiding rules:** vertical slices > whole-subsystem builds; software-only work is separated from hardware work (tagged **[SW]** / **[HW]**); the physical arm is introduced only in Phase 5; nothing depends on real hardware before it's needed.
- **Scope note:** realistic for a student project. No new runtime technologies beyond what product-spec/architecture already establish. Test tooling is limited to what's natural per language (Vitest/RTL, pytest, supertest, mongodb-memory-server, simulated serial device).
- **Infrastructure decision:** MongoDB is **not** installed on the host system. It runs as a Docker container managed by Docker Compose, started with `docker compose up -d`. The backend connects to it over `localhost` (port from config). All startup, setup, test, and demo instructions in this plan assume this containerized setup.
- **Runtime and process placement:** the Node.js backend and MongoDB run inside **WSL Ubuntu**; the Python CV service runs **natively on the Windows host** (it needs direct webcam access and does not rely on WSL camera passthrough); the dashboard runs in the browser on Windows. Cross-process traffic is always over `localhost` via WSL2's built-in localhost forwarding. See `architecture.md` §1 and §3.

## Phase dependency order

```
Phase 1  Session spine (no camera, no arm)   ← recommended FIRST vertical slice
   ↑
Phase 2  Python CV detection (software only)
   │
   ├──▶ Phase 3  Detection service wired into spine
   │
   └──▶ Phase 4  Mock arm + full block/correct/unblock loop  ← 2nd vertical slice
                       ↑
Phase 5  Real Arduino hardware integration   ← first physical hardware
                       ↑
Phase 6  Final integration, robustness, demo rehearsal
```

Phases 1 and 2 can run in parallel after Phase 0; Phase 3 needs both. Phase 4 needs Phase 3 (backend FSM) and can start as soon as the hardware protocol is drafted. Phase 5 needs Phase 4's protocol contract. Phase 6 needs everything.

## ADR reference (from `architecture.md` §12)

| ADR | Topic | Resolved by |
|---|---|---|
| ADR-1 | Dashboard push mechanism (SSE vs WS vs polling) | Phase 1 (M1.3) |
| ADR-2 | Backend→Arduino transport (serial model) | Phase 4 (M4.1) |
| ADR-3 | Event idempotency (dedupe) | Phase 3 (M3.1) |
| ADR-4 | Hardware protocol frame format | Phase 4 (M4.1) |
| ADR-5 | Session end during in-progress BLOCK | Phase 4 (M4.2) |
| ADR-6 | Mongo-out behavior | Phase 1 (M1.1) |
| ADR-7 | Auth between local services | Phase 0 |
| ADR-8 | Servo-to-joint assignment | Phase 5 (M5.2) |
| ADR-9 | Settings scope | Phase 3 (M3.3) |
| ADR-10 | Serving the app (Express static vs Vite) | Phase 0 / M1.3 |

---

## Phase 0 — Foundation and decisions **[SW]**

**Prerequisites:** Node.js and Docker (with the `docker compose` plugin) installed on the WSL Ubuntu side; Python installed on the Windows host (`cv/` is a native Windows process); git repo created; `docs/` exists. MongoDB is **not** installed on the host — it runs as a Docker container (set up in M0.1).

**Milestones:**

### M0.1 — Monorepo scaffold + tooling
- **Objective:** establish the repository layout from `architecture.md` §6 with runnable empty services, plus a Docker Compose setup for the containerized MongoDB.
- **Files/modules:** repo root (`backend/`, `cv/`, `web/`, `firmware/`, `hardware/`, `docs/`), `docker-compose.yml` (MongoDB service: image, host port, named volume for data), `.env.example`, basic README, run scripts.
- **Expected behavior:** MongoDB starts in a Docker container via `docker compose up -d` (inside WSL) and is reachable from the WSL backend on `localhost`; the Python service on Windows boots a trivial "hello" (healthcheck) on `localhost` and can reach the WSL backend over WSL2 localhost forwarding; every process binds `127.0.0.1`.
- **Tests/verification:** `docker compose up -d` brings MongoDB up and `docker compose ps` reports it healthy; each service's health endpoint returns 200 (backend health hit from Windows resolves through WSL2 forwarding); `npm run dev` (WSL) / `python -m <module>` (Windows) both start clean.
- **Blocking ADRs:** ADR-7 (auth default = none), ADR-10 (serving model).
- **Definition of done:** clean scaffold, documented startup commands, `.env.example` created, MongoDB runnable as a container, nothing else implemented.

### M0.2 — Cross-cutting configuration
- **Objective:** ports, Mongo URI, camera index, serial port placeholder all configurable via environment; Mongo URI defaults match the host port exposed by `docker-compose.yml`; the Python service's `backend_url` defaults to `http://127.0.0.1:PORT` (the WSL backend over localhost forwarding).
- **Files/modules:** `.env.example`, service config modules.
- **Expected behavior:** services read config from env with sensible defaults; no secrets committed.
- **Tests/verification:** start services with alternate ports via env; config module unit tests.
- **Blocking ADRs:** none.
- **Definition of done:** configuration is centralized and documented.

---

## Phase 1 — Session spine (first vertical slice, No camera, No arm) **[SW]**

**Prerequisites:** Phase 0. This is the recommended first slice: a thin end-to-end path *through the whole stack* — dashboard → backend → MongoDB → dashboard — proving the web layer works before any AI or hardware.

### M1.1 — Backend skeleton, Mongo wiring, health/status
- **Objective:** Express app that connects to MongoDB (the container from M0.1) and reports health.
- **Files/modules:** `backend/src/app.js`, `routes/`, `persistence/`, `docker-compose.yml`.
- **Expected behavior:** `GET /api/status` returns service + Mongo state per `architecture.md` §4.1, using the containerized Mongo reached over `localhost:PORT`.
- **Tests/verification:** supertest unit tests; mongodb-memory-server integration test; manual curl against the running container; `docker compose stop mongo` to exercise the Mongo-out path (ADR-6).
- **Blocking ADRs:** ADR-6 (Mongo-out behavior — need a decision for the error path).
- **Definition of done:** health endpoint tested and green; Mongo failure path established.

### M1.2 — Session state machine + session API
- **Objective:** backend owns the authoritative session lifecycle (`architecture.md` §7.1) with persistence.
- **Files/modules:** `backend/src/sessions/`, `routes/sessions`, `persistence/`.
- **Expected behavior:** `POST /api/sessions`, `GET /api/sessions/active`, `POST /api/sessions/:id/end`; FSM transitions `idle→baseline_capturing→monitoring→…→ended`; sequences persisted in Mongo.
- **Tests/verification:** unit tests on every FSM transition; integration tests for persistence and invalid-call rejection.
- **Blocking ADRs:** none (state machine shape already defined in `architecture.md`).
- **Definition of done:** full session lifecycle works over HTTP with Mongo persistence, verified by tests.

### M1.3 — Dashboard skeleton
- **Objective:** React + Vite app that can start/end sessions and show status.
- **Files/modules:** `web/src/pages/`, `components/`, `api/`, `hooks/`.
- **Expected behavior:** "Start session" button → session begins; status shows `baseline_capturing`/`monitoring`; "End" ends it.
- **Tests/verification:** Vitest + React Testing Library with mocked API client.
- **Blocking ADRs:** ADR-1 (choose SSE vs polling — even if only adopted later, the API shape depends on it), ADR-10.
- **Definition of done:** dashboard drives the session API and renders state from it.

### M1.4 — First vertical slice integration (completes slice ✅)
- **Objective:** close the loop dashboard → backend → Mongo → dashboard.
- **Files/modules:** integration touches all of the above.
- **Expected behavior:** on localhost, a user can start a session, see it in the MongoDB container, and end it; failures surface in the dashboard.
- **Tests/verification:** manual end-to-end walkthrough; backend integration test covering the whole slice with mocked dashboard/camera.
- **Blocking ADRs:** none.
- **Definition of done:** the thin slice is demonstrable end-to-end without camera or arm.

---

## Phase 2 — Python CV detection (software only) **[SW]**

**Prerequisites:** Phase 0 bootstrapping; Phase 1 M1.2 (backend must already accept session events). Can run in parallel with Phase 1.

### M2.1 — CV service skeleton + events client
- **Objective:** service runs **natively on the Windows host** with direct webcam access, captures frames, and can post events to the WSL backend over `localhost`.
- **Files/modules:** `cv/src/camera/`, `events/`, config.
- **Expected behavior:** on Windows, the service opens the physical webcam (OpenCV); on session start, frames are captured; `session_start`/`baseline_captured` events reach the WSL backend over `localhost` (WSL2 forwarding).
- **Tests/verification:** fake camera frames unit tests (run on Windows); contract test posting events to a mock backend (verifies `localhost` event path).
- **Blocking ADRs:** none.
- **Definition of done:** the service runs on the Windows host, captures webcam frames, and can emit events to the backend over `localhost`.

### M2.2 — Pose detection + baseline capture
- **Objective:** MediaPipe Pose works and produces a per-session upright-pose baseline (FR-02, FR-05).
- **Files/modules:** `cv/src/pose/`.
- **Expected behavior:** after ~2–3 s of upright posture, a baseline is computed and a `baseline_captured` event emitted with deviation measurements.
- **Tests/verification:** synthetic landmark fixtures; real-camera spot-check on the Windows host.
- **Blocking ADRs:** none.
- **Definition of done:** baseline capture is accurate enough to detect a clear slouch in practice.

### M2.3 — Violation rules / debounce logic
- **Objective:** FR-07–FR-09 timers: slouch and correction events only fire after the sustained duration.
- **Files/modules:** `cv/src/rules/`.
- **Expected behavior:** `slouch_violation` and `correction_requested` events emitted with correct timing; transient deviations don't trigger.
- **Tests/verification:** pure logic unit tests with synthetic pose/phone state sequences.
- **Blocking ADRs:** none.
- **Definition of done:** the FSM/debounce logic is fully unit-tested and deterministic.

### M2.4 — Phone detection
- **Objective:** YOLOv8 Nano + MediaPipe Hands produce `phone_violation` events (FR-06, FR-08).
- **Files/modules:** `cv/src/phone/`.
- **Expected behavior:** phone + hand interaction detected; sustained interaction emits `phone_violation`; release emits correction.
- **Tests/verification:** curated positive/negative image/video fixtures; unit tests on debounce path.
- **Blocking ADRs:** none.
- **Definition of done:** phone violations detectable with acceptable false-trigger rate for a demo.

---

## Phase 3 — Detection service wired into the spine **[SW]**

**Prerequisites:** Phase 1 (session spine) and Phase 2 (CV).

### M3.1 — Event contract between Python and backend
- **Objective:** `architecture.md` §4.2 boundary implemented and enforced end-to-end.
- **Files/modules:** `cv/src/events/`, `backend/src/validation/`.
- **Expected behavior:** backend validates all Python events (valid session, legal ordering, plausible timestamps); the session FSM is now driven by real detection events.
- **Tests/verification:** contract/integration tests between cv client and backend; validation unit tests.
- **Blocking ADRs:** ADR-3 (idempotency — decide whether event IDs dedupe retries).
- **Definition of done:** a real session runs from `baseline_captured` → violations → corrections with all events persisted.

### M3.2 — Event history + statistics
- **Objective:** dashboard shows history and stats per FR-23/F-25 (and FR-21).
- **Files/modules:** `web/src/components/` history/stats, `backend/src/routes/` `/api/events`, `/api/statistics`.
- **Expected behavior:** violations, corrections, and blocking events listed with timestamps; session statistics visible.
- **Tests/verification:** component tests with mocked data; backend statistics unit tests.
- **Blocking ADRs:** none.
- **Definition of done:** history and stats for a running session render correctly.

### M3.3 — Settings
- **Objective:** expose configurable violation thresholds/durations in the dashboard (FR-25).
- **Files/modules:** `backend/src/routes/settings`, `web` settings page, `cv/src/rules` reads settings from backend.
- **Expected behavior:** thresholds pushed to cv without restart; invalid values rejected.
- **Tests/verification:** settings API tests; rules module reads settings correctly.
- **Blocking ADRs:** ADR-9 (which settings are live-editable vs fixed).
- **Definition of done:** settings are editable and affect detection behavior.

---

## Phase 4 — Mock arm + full block/correct/unblock loop **[SW]**

**Prerequisites:** Phase 3, plus drafted hardware protocol. This is the key second vertical slice: the *entire* behavior loop works end-to-end with a simulated arm, so the demo can run without hardware.

### M4.1 — Backend hardware module with simulated device
- **Objective:** `backend/src/hardware/` speaks the `BLOCK`/`RETRIEVE`/`STATUS` protocol `architecture.md` §4.3 against a mock serial device.
- **Files/modules:** `backend/src/hardware/`, a test double (fake firmware in test harness).
- **Expected behavior:** BLOCK → `blocking → blocked`; RETRIEVE → `unblocking → monitoring`; atomic sequencing; a timeout/`ERROR` path.
- **Tests/verification:** backend integration tests with the fake device; failure injection (stall, no response).
- **Blocking ADRs:** ADR-2 (transport), ADR-4 (frame format).
- **Definition of done:** mock-arm BLOCK/RETRIEVE sequences fully tested.

### M4.2 — Full loop with mock arm (2nd vertical slice ✅)
- **Objective:** real webcam (Windows host) → real detection → mock arm blocks → correction unblocks.
- **Files/modules:** `web` blocking-status UI (FR-22), backend session FSM, cv events.
- **Expected behavior:** a real slouch in front of the webcam shows card-at-screen status in the dashboard; correcting posture clears it.
- **Tests/verification:** end-to-end scripted test using mock arm; demo walkthrough.
- **Blocking ADRs:** ADR-5 (end-of-session RETRIEVE behavior).
- **Definition of done:** the entire product loop is demonstrable on the laptop with no physical arm.

---

## Phase 5 — Real Arduino hardware integration (first physical hardware) **[HW]**

**Prerequisites:** Phase 4 protocol contract; ADRs 2 & 4 resolved; ADR-8 (servo mapping) confirmed against the physical build. **This is where the real Arduino is introduced.**

### M5.1 — Firmware skeleton: serial protocol + servo driver
- **Objective:** Arduino parses backend commands and drives PCA9685.
- **Files/modules:** `firmware/` (`command_parser/`, `servo_driver/`).
- **Expected behavior:** commands from a host terminal/reset tool produce ACK/STATUS responses; servos move on command; POWER-ON homing (fail-safe).
- **Tests/verification:** host-side command-simulator harness against the parser; bench test moving each servo; serial loopback tests on the bench.
- **Blocking ADRs:** ADR-2, ADR-4, ADR-8.
- **Definition of done:** firmware reliably responds to BLOCK/RETRIEVE/STATUS over serial with no unexplained behavior.

### M5.2 — Arm motion primitives + calibration
- **Objective:** the arm physically picks the card from the dock, moves it in front of the screen, and returns.
- **Files/modules:** `firmware/arm_controller/`, `hardware/` notes (BOM, wiring, assembly).
- **Expected behavior:** BLOCK_OK and RETRIEVE_OK only after the motion completes; stall/fault paths emit ERROR.
- **Tests/verification:** bench scripted sequence: BLOCK → wait → RETRIEVE; fault injection (hand-stall); power-cycle homing test.
- **Blocking ADRs:** ADR-8.
- **Definition of done:** arm can reliably block and unblock the laptop screen on the bench.

### M5.3 — Full hardware swap
- **Objective:** backend commands the real Arduino instead of the mock.
- **Files/modules:** `backend/src/hardware/` real serial driver; hooking detection (unplugged/disconnected).
- **Expected behavior:** end-to-end: webcam → detection → real arm blocks → correction → real arm unblocks; fails safe (no blocking) if the serial link is unhealthy.
- **Tests/verification:** end-to-end demo run on hardware; unplug/replug recovery test per `architecture.md` §8.
- **Blocking ADRs:** none.
- **Definition of done:** full hardware path works exactly as the mock did in M4.2.

---

## Phase 6 — Final integration, robustness, demo **[SW]** + **[HW]**

**Prerequisites:** Phases 3, 4, 5 complete.

### M6.1 — Robustness pass
- **Objective:** implement the error-handling table in `architecture.md` §8 (heartbeats, degraded states, Mongo-out, Python crash).
- **Files/modules:** cross-cutting; mostly `backend/`, `cv/`, `web/`.
- **Expected behavior:** any single-subsystem failure degrades gracefully with visible dashboard banners; never a stuck card.
- **Tests/verification:** failure-scenario integration tests (kill camera, stop Mongo container with `docker compose stop`, kill backend, unplug Arduino); dashboard error states.
- **Blocking ADRs:** none.
- **Definition of done:** all §8 scenarios behave as specified.

### M6.2 — Settings/statistics finalization + UI polish
- **Objective:** finish dashboard polish, statistics, and demo-first UX.
- **Files/modules:** `web/`.
- **Expected behavior:** dashboard is usable, accurate, and presentable.
- **Tests/verification:** component tests; manual usability pass.
- **Blocking ADRs:** none.
- **Definition of done:** dashboard is demo-quality.

### M6.3 — End-to-end integration + demo rehearsal ✅
- **Objective:** final acceptance + a rehearsed live demo.
- **Files/modules:** `docs/` demo checklist, `hardware/` pre-flight notes.
- **Expected behavior:** scripted scenario works every time: start session → sit upright (baseline) → slouch (real arm blocks) → correct (arm unblocks) → end session.
- **Tests/verification:** full end-to-end acceptance run; pre-flight checklist (camera ready on Windows, serial connected from WSL, MongoDB container running via `docker compose up -d`); dry-run rehearsal.
- **Blocking ADRs:** none.
- **Definition of done:** the complete PostureGuard flow — detection → violation → physical blocking → correction → unblocking, with persisted history and dashboard statistics — is demonstrated successfully.

---

## Software-only vs hardware work (summary)

- **[SW]** Phases 0–4 and everything up to M5.3's swap: all logic, services, tests, and the two vertical slices are fully demonstrable with a mock arm.
- **[HW]** Phase 5 and the hardware portions of Phase 6: physical assembly, firmware on real silicon, arm calibration, and the final full-demo rehearsal.
- The mock device in Phase 4 is *software-only*; it exists precisely so hardware work stays isolated in its own phase.