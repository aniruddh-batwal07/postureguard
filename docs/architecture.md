# PostureGuard — Technical Architecture

- **Authoritative source:** `docs/product-spec.md`
- **Scope:** Architecture design only. No implementation.
- **Tone:** Simple, reliable, demonstrable — appropriate for a student project.
- Open decisions are marked **`[ADR]`** (architecture decision requiring human
  confirmation). They are listed together in section 12.

---

## 1. High-Level System Architecture

PostureGuard is fully **local**, running on a single laptop. It is built from
three cooperating processes plus an embedded controller:

```
                        ┌─────────────────────────────┐
                        │      Laptop (single host)     │
                        │                              │
  ┌──────────────┐      │  ┌────────────────────────┐  │
  │   Webcam     │────▶│  │  Python CV Service     │  │
  │  (hardware)  │      │  │  (pose + phone detect)│  │
  └──────────────┘      │  └───────────┬────────────┘  │
                        │              │  HTTP events  │
                        │              ▼              │
                        │  ┌────────────────────────┐  │
                        │  │ Node.js + Express      │  │
                        │  │ Backend (state owner)  │  │
                        │  └─────┬──────────┬───────┘  │
                        │        │          │          │
                        │  ┌─────▼────┐  ┌──▼───────┐  │
                        │  │ MongoDB  │  │ Dashboard│  │
                        │  │ (local)  │  │ React+Vite│ │
                        │  └──────────┘  └──────────┘  │
                        └───────────────┬──────────────┘
                                        │  serial link
                                        ▼
                        ┌─────────────────────────────┐
                        │    Arduino controller       │
                        │    (firmware + PCA9685)     │
                        └──────────────┬──────────────┘
                                       ▼
                        ┌─────────────────────────────┐
                        │  Robotic arm (4‑DOF) ──▶    │
                        │  Blocker card + dock        │
                        └─────────────────────────────┘
```

### Architectural style
- **Local monolith over local network** — three long-running processes on one
  host communicating over `localhost`, with the hardware attached via a serial
  link. No cloud, no external services.
- **The Node.js backend is the single source of truth** for session state,
  event history, and hardware command sequencing.
- **The Python CV service is a detection engine**: it runs the vision models,
  owns the debounce/timer logic, and emits events. It holds no authoritative
  persisted state.
- **The Arduino is a command executor**: it does exactly what the backend asks
  (`BLOCK` / `RETRIEVE`) and reports completion. It makes no detection
  decisions.
- **The dashboard is a client**: it reflects backend state and issues
  user-level commands (start/stop session, view history/settings).

### Why this shape
- Keeps vision (Python), application logic (Node), and UI (React) in the
  languages already decided (spec §8).
- The three-process split matches the spec's described architecture (spec
  §5/§7) and keeps each piece independently testable.
- The hardware is encapsulated behind two commands, so the system can be
  demoed with a mocked arm when real hardware is unavailable.

---

## 2. Responsibilities of Each Subsystem

### 2.1 React + Vite frontend (dashboard)
- Renders the UI described by spec FR-19–FR-25: current monitoring status,
  live posture information, violations, screen-blocking status, event history,
  session info, settings, and statistics.
- Issues user commands: start session, end session (spec §3 step 1/9).
- Subscribes to backend state updates and renders them (spec FR-14).
- Has **no** direct contact with the Python service, MongoDB, or the Arduino.
- Serving model: Vite dev server during development; a static build served by
  the Express backend for the demo.

### 2.2 Python computer vision service
- Captures the laptop webcam feed (spec FR-04).
- Runs MediaPipe Pose for posture detection (FR-05) and YOLOv8 Nano +
  MediaPipe Hands for phone-use detection (FR-06).
- Establishes the per-session posture baseline when the user sits upright at
  session start (spec §3 step 2; FR-02).
- Owns the violation timers/debounce rules: a slouch or phone violation is only
  confirmed once the condition persists for a defined duration (FR-07–FR-09).
- Continues monitoring during blocking and emits correction events when the
  user has held correct behavior for the required duration (spec §3 step 7).
- Sends `session_start`, `baseline_captured`, violation, and correction events
  to the backend over HTTP (spec §7 step 3/6).
- Does **not** persist data, does **not** command hardware directly, and does
  **not** serve the dashboard.

### 2.3 Node.js + Express backend
- Owns the session lifecycle and is the **single source of truth** for state.
- Exposes a small REST API for the Python service and the dashboard.
- Validates every incoming event before acting (spec FR-11: `session_key`,
  `session_id`, event ordering).
- Persists events and sessions in MongoDB (FR-12).
- Sequences hardware actions: dispatches `BLOCK`/`RETRIEVE` to the Arduino and
  waits for completion acknowledgements (FR-13, FR-15–FR-16, FR-18).
- Pushes state updates to the dashboard (FR-14).
- Tracks a heartbeat for the Python service and the Arduino to surface
  degradation.

### 2.4 MongoDB
- Local instance on the laptop (single-user, spec §11).
- Stores: sessions, baseline records, violation/correction events, screen-block
  events, and computed statistics for the dashboard (spec §5.3).
- Not accessed by the webcam, the Python service, or the dashboard directly —
  writes go through the backend.

### 2.5 Arduino firmware
- Runs on the Arduino (explicitly NOT ESP32; spec §8/§11).
- Reads a command stream from the backend over the serial link and executes
  commands in order. It serializes concurrent requests so actions complete
  atomically (FR-18).
- Implements two primitives: `BLOCK` (pick card from dock → move in front of
  screen) and `RETRIEVE` (return card to dock), plus `STATUS` for reporting
  arm state.
- Drives the six servos (3× MG996R + 3× SG90) through the PCA9685 (`[ADR]`
  on joint assignment — see §12).
- Reports completion `ACK`/`DONE` or an explicit `ERROR` after each command.
- Contains **no** detection logic and makes **no** decisions about *whether* to
  block — it only executes.

### 2.6 Robotic arm
- The physical 4‑DOF arm, blocker card, and dock (spec §6).
- Its only externally visible behavior is "card at screen" or "card in dock",
  reached via `BLOCK` / `RETRIEVE`.
- The card carries the fixed message **"Fix your posture."** (spec §11).

---

## 3. Communication Paths Between All Subsystems

| # | From | To | Transport | Payload / Purpose |
|---|---|---|---|---|
| 1 | Webcam | Python CV | OS camera API | raw video frames (never leaves the host) |
| 2 | Python CV | Backend | HTTP/JSON (`localhost`) | control + detection events |
| 3 | Backend | MongoDB | MongoDB wire protocol (`localhost`) | persistence |
| 4 | Backend | Dashboard | HTTP/JSON + state push `[ADR-1]` | API + live updates (FR-14) |
| 5 | Backend | Arduino | serial link `[ADR-2]` | `BLOCK` / `RETRIEVE` / `STATUS` |
| 6 | Arduino | Backend | serial link | `ACK` / `DONE` / `ERROR` / `STATE` |

**Direct paths deliberately excluded:** dashboard ↔ Python, dashboard ↔
MongoDB, Python ↔ Arduino, dashboard ↔ Arduino, Mongo ↔ Python. All
cross-subsystem communication flows through the backend (except webcam → CV,
which is purely local to the Python process).

---

## 4. API / Event Boundaries

### 4.1 Backend REST API

| Method | Path | Purpose | Caller |
|---|---|---|---|
| `POST` | `/api/sessions` | start a session (triggers baseline phase) | Dashboard |
| `POST` | `/api/sessions/:id/end` | end the session | Dashboard |
| `GET` | `/api/sessions/active` | current active session + status | Dashboard |
| `POST` | `/api/events` | submit detection events | Python CV |
| `GET` | `/api/events?sessionId=` | event history | Dashboard |
| `GET` | `/api/status` | health + blocking status overall | Dashboard |
| `GET` | `/api/statistics` | aggregated stats | Dashboard |
| `GET` `PUT` | `/api/settings` | violation thresholds/durations | Dashboard |
| `GET` | `/api/subscribe` | pushed state channel `[ADR-1]` | Dashboard |

### 4.2 Detection event boundary (Python → Backend)
Textual event envelope (no implementation): each event carries a type, a
`sessionId`, a timestamp, and optional data (e.g., posture deviation, phone
detection confidence). Event types mirror spec §7:
`session_start`, `baseline_captured`, `slouch_violation`, `phone_violation`,
`correction_requested`, `session_end`.

Backend validation rules (FR-11): event must reference a known active session,
occur in legal order, and have a plausible timestamp. Duplicate events
(`[ADR-3]` idempotency) are tolerated.

### 4.3 Hardware command boundary (Backend → Arduino)
Text command protocol over serial — newline-delimited tokens (no
implementation), to be frozen in firmware contract `[ADR-4]`:
- `BLOCK` → arm moves card to screen → `BLOCK_OK`
- `RETRIEVE` → arm returns card to dock → `RETRIEVE_OK`
- `STATUS` → `STATE_DOCKED` | `STATE_BLOCKED` | `STATE_BUSY`
- `ERROR_*` reported on any failure (stall, timeout, servo fault)

### 4.4 Versioning
Student project scope: no API versioning. Backward-incompatible changes are
acceptable only inside the repo, coordinated across the three services.

---

## 5. Data Flow for Each Key Flow

Naming: **D** = Dashboard, **B** = backend, **P** = Python CV, **M** = MongoDB,
**A** = Arduino/Robotic arm.

### 5.1 Session start
1. D → `POST /api/sessions` → B validates, creates session document in M, marks
   state `baseline_capturing`, replies with `sessionId`.
2. B → D: session active, awaiting baseline.
3. B → P: (fires) begin capture for `sessionId`.
4. P starts webcam capture; publishes monitoring state to B.

### 5.2 Baseline capture
1. P runs pose detection on live frames for the configured window (spec §3
   step 2) and computes the upright-pose baseline.
2. P → B: `baseline_captured` event (with baseline reference + sessionId).
3. B validates, persists to M, transitions session state to `monitoring`.
4. B → D: push "monitoring, baseline established" (FR-20).

### 5.3 Slouch violation
1. P compares live pose to baseline; starts a debounce timer when below
   baseline.
2. If the condition persists for the defined duration: P → B:
   `slouch_violation`.
3. B validates event, persists it in M, updates statistics, and — if the screen
   is not already blocked — queues a `BLOCK` (drains to 5.5).
4. B → D: violation record shown; blocking status → `blocking`.

### 5.4 Phone violation
1. P detects phone + hand interaction (YOLOv8 Nano + MediaPipe Hands); starts
   debounce timer.
2. If interaction persists for the defined duration: P → B: `phone_violation`.
3. B validates, persists in M, and, if not already blocked, queues `BLOCK`.
4. B → D: phone violation record; blocking status → `blocking`. If a phone
   violation arrives while already blocked, it is logged but no duplicate
   command is sent (FR-18).

### 5.5 BLOCK
1. Prior step: B → A: `BLOCK` over the serial link.
2. A executes (dock → pick card → move to screen); reports `BLOCK_OK`.
3. B transitions session state to `blocked`; updates blocking status in M and
   pushes to D (FR-22).
4. P is unaffected — it continues monitoring behind the blocker card.

### 5.6 Correction
1. While blocked, P keeps monitoring pose and phone use (spec §3 step 7).
2. When the corrected behavior persists for the required duration, P → B:
   `correction_requested`.
3. B validates, persists correction event, and queues `RETRIEVE` (drains to
   5.7).

### 5.7 RETRIEVE
1. B → A: `RETRIEVE`.
2. A executes (move to screen → pick card → return to dock); reports
   `RETRIEVE_OK`.
3. B transitions session back to `monitoring`; pushes screen-unblocked to D.

### 5.8 Session end
1. D → `POST /api/sessions/:id/end`.
2. B persists `session_end`, transitions session to `ended`; computes final
   statistics for the session.
3. B tells P to stop capture; P emits `session_end` (or silently stops).
4. If the arm is mid-block at close, B issues a final `RETRIEVE` so the card
   returns to dock before the app stops `[ADR-5]`.

---

## 6. Proposed Repository / Module Boundaries

Single monorepo with isolation by top-level folder — one repository is simpler
for a student project and lets the demo be run from one place.

```
postureguard/
├── docs/                  # product-spec.md, architecture.md
├── backend/               # Node.js + Express service
│   ├── src/
│   │   ├── routes/        # REST endpoints (spec §4.1)
│   │   ├── validation/    # incoming events (FR-11)
│   │   ├── sessions/      # session state machine (spec §7)
│   │   ├── persistence/   # MongoDB access (FR-12)
│   │   ├── hardware/      # serial driver + BLOCK/RETRIEVE sequence
│   │   └── subscribe/     # dashboard state push [ADR-1]
│   └── test/
├── cv/                    # Python computer vision service
│   ├── src/
│   │   ├── camera/        # webcam capture
│   │   ├── pose/          # MediaPipe Pose baseline + deviation
│   │   ├── phone/         # YOLOv8 Nano + MediaPipe Hands
│   │   ├── rules/         # debounce/timer violations (FR-07–09)
│   │   └── events/        # HTTP client to backend
│   └── test/
├── web/                   # React + Vite dashboard
│   ├── src/
│   │   ├── api/           # backend client
│   │   ├── hooks/         # live subscription [ADR-1]
│   │   ├── components/    # status, posture, history, stats, settings
│   │   └── pages/
│   └── test/
├── firmware/              # Arduino sketch
│   ├── command_parser/    # serial protocol (spec §4.3)
│   ├── arm_controller/    # joint positions / motion sequencing
│   └── servo_driver/      # PCA9685 + MG996R/SG90 control
└── hardware/              # notes: BOM, wiring, assembly
```

Module ownership rules:
- Python modules depend only on their own folder + the events client.
- Backend modules depend only on other backend modules + Mongo + serial.
- The dashboard never imports Python or Arduino code.
- The Arduino arming sequence is co-ordinated between the backend `hardware/`
  module and firmware — the single place where the two sides of the
  hardware/software boundary must agree (spec §9 boundary).

---

## 7. State Management and Major System States

Three cooperating state machines; the **backend session machine is
authoritative** and the others report into it.

### 7.1 Backend session state (authoritative)
`idle → baseline_capturing → monitoring ⇄ blocked → ending → ended`

| State | Meaning |
|---|---|
| `idle` | no active session |
| `baseline_capturing` | waiting for `baseline_captured` from Python |
| `monitoring` | normal tracking; violations may trigger `BLOCK` |
| `blocking` | `BLOCK` sent, awaiting `BLOCK_OK` (transient) |
| `blocked` | card at screen; correction may trigger `RETRIEVE` |
| `unblocking` | `RETRIEVE` sent, awaiting `RETRIEVE_OK` (transient) |
| `ending` | final `RETRIEVE` + cleanup on session end |
| `ended` | session closed; history/statistics still viewable |

### 7.2 Python detection state (reports upward)
`idle → capturing_baseline → monitoring → (blocked: still monitoring) → idle`

### 7.3 Arduino arm state (reports upward)
`DOCKED → BLOCKING → BLOCKED → RETRIEVING → DOCKED`, plus `BUSY` / `FAULT`.

### 7.4 Dashboard state (mirror)
The dashboard renders a projection of backend state: session status, blocking
status, last-plus-history of violations, live posture indicator, and health of
each subsystem (from heartbeats). It never mutates authoritative state except
via `start` / `end` / settings.

### 7.5 State updates
All transitions are persisted to MongoDB and pushed to the dashboard
(Fragment: the push mechanism is `[ADR-1]`). The dashboard may also poll
`/api/status` as a fallback.

---

## 8. Error Handling and Failure Scenarios

| Failure | Detection | Behaviour | User-visible result |
|---|---|---|---|
| Camera unavailable / busy | Python startup self-check | Session start is refused or degraded; error event to backend | Dashboard error banner |
| Python service crash | Backend heartbeat timeout | Session marked `degraded`; no violations evaluated; no blocking | "Detection offline" banner; screen not blocked |
| Backend momentary outage | Python HTTP retry | Python retries emits with backoff (bounded queue) | Self-heals on restart |
| MongoDB down | Backend write failure | Backend refuses new events with clear error; retries on restart `[ADR-6]` | Dashboard error on history/stats |
| Arduino unplugged / serial lost | Backend serial timeout | `BLOCK`/`RETRIEVE` reported failed; blocking abandoned for that event | "Hardware offline" banner; no silent partial block |
| Arm stall / servo fault | Firmware `ERROR_*` or command timeout | Firmware reports error; backend marks arm `faulted`, retries once, then requires manual reset | Card stays put; manual reset prompt |
| Power loss mid-block | N/A (no connection) | Fail-safe: arm returns home on next power-up (homing sequence before first command) | Card returned to dock on reboot |
| Duplicate event (retry) | Event idempotency check `[ADR-3]` | Second copy ignored | None |
| Concurrent `BLOCK`/`RETRIEVE` | Firmware serializes + atomic transition (FR-18) | Commands queued in order | Clean sequencing |
| Invalid HTTP payloads | Backend validation (FR-11) | `400` + counter; event not persisted | Logged only |
| Settings malformed | Backend validation | Rejected | Dashboard form inline error |

Fail-safe principle: **when any subsystem is unhealthy, the system degrades to
"no physical blocking" rather than risking a stuck card or an unexpected arm
motion.** Blocking is the only risky hardware action and is always gated on a
healthy serial link + acknowledged arm state.

---

## 9. Hardware / Software Boundary

- **Boundary line:** the serial link between the Node backend (software host
  side) and the Arduino firmware (embedded side). Everything above is software;
  everything below is embedded software + electromechanical hardware.
- **Contract at the boundary:** the tiny text protocol in §4.3. The backend
  never reasons about joints, angles, or servo pulses; the firmware never
  reasons about sessions or violations.
- **Simulation seam:** the backend `hardware/` module is the only place that
  speaks the protocol. Swapping the real serial link for a mock (for tests or
  demos without hardware) touches only that module.
- **Electromechanical interface:** firmware → PCA9685 → 6 servos → arm.
  Detailed joint mapping, limits, and speed are a firmware-side concern.
- **Power:** servos draw significant current; servos are powered separately
  from the Arduino logic supply (hardware guide). This is mechanical/electrical,
  outside this architecture beyond the firmware note.
- **No software dependency crosses the boundary:** Python and Node never call
  into firmware code and vice versa.

---

## 10. Security and Local-System Considerations

- **Bind everything to `127.0.0.1`** (Express, Mongo, Vite, Python HTTP
  client). Nothing listens on a routable interface.
- **Webcam frames never leave the Python process.** No video over the wire.
- **CORS:** dashboard served from the Express origin or same-origin in
  production; in dev, CORS is restricted to `localhost` origins.
- **No authentication** for a single-user local app. Optional shared secret
  between Python → backend `[ADR-7]` to prevent accidental cross-talk from
  other local processes; default: no auth.
- **MongoDB** is bound to localhost with no external auth; use a project
  database name; no default-internet credentials in code.
- **No secrets in the repository.** Settings and ports come from a local
  `.env` (git-ignored); `.env.example` documents keys.
- **Serial device permission:** the Arduino's serial port must be
  discoverable; backend refuses to start the blocking subsystem if the port
  is unavailable (fails safe).
- **Strict validation on all inter-process payloads** (JSON schema level)
  because three independent services trust the wire.
- **Sane limits** on event rate to prevent an unbounded Mongo write storm from
  a pathological camera loop.

---

## 11. Testing Strategy (High Level)

Unit / integration / demo; no test framework mandated (use the natural tool for
each language; confirm in implementation).

- **Python (`cv/`)**
  - Unit: debounce timer logic (FR-07–FR-09) with synthetic pose/phone
    sequences; baseline computation from synthetic landmarks.
  - Integration: fake camera frames → assert emitted event stream; contract
    test against the backend's `/api/events` using a mocked backend.
- **Backend (`backend/`)**
  - Unit: session state machine transitions; event validation (FR-11).
  - Integration: in-memory Mongo (`mongodb-memory-server`) for persistence;
    mocked serial device asserting `BLOCK`/`RETRIEVE` + ACK sequencing; a
    fake Arduino for BLOCK→blocked→correction→RETRIEVE walkthroughs.
- **Dashboard (`web/`)**
  - Component tests for status/history/stats/settings with a mocked API
    client; happy-path flow test for start → monitoring.
- **Firmware (`firmware/`)**
  - Host-side simulator driving the command protocol against the same parser
    used by hardware (parsing can be shared or mirrored); on-bench manual
    sequence: BLOCK_OK → wait → RETRIEVE_OK, and fault injection (stall).
- **End-to-end / demo rehearsal**
  - Scripted scenario on the laptop: start session → sit upright (baseline) →
    slouch (block shown/arm triggered) → correct (unblock) → end.
  - A *rehearsal checklist* with camera, serial, and Mongo pre-flight checks so
    the demo is reliable in front of an audience.
- **Mock seam reuse:** the backend hardware mock enables full end-to-end tests
  without the arm (CI-capable).

---

## 12. Important Architectural Decisions Requiring Human Confirmation

These are places where the specification is silent or under-determined. Nothing
here should be treated as settled.

- **[ADR-1] Dashboard live updates.** Spec says the backend "pushes state
  updates to the dashboard" (FR-14). Options: (a) Server-Sent Events
  recommended — one-directional, simpler than WebSockets, fits push requirement;
  (b) WebSockets; (c) HTTP polling fallback. Needs confirmation.
- **[ADR-2] Backend → Arduino transport.** Spec explicitly rules out ESP32 and
  the assuming wired/USB serial in `product-spec.md §11`. Confirm the actual
  Arduino model and transport: (a) native USB serial, (b) USB host → TTL
  converter, or (c) WiFi/Bluetooth shield. This governs the serial protocol and
  driver.
- **[ADR-3] Event idempotency.** Whether duplicate `slouch_violation` /
  `correction_requested` events (from Python retries) are deduplicated on the
  backend via event IDs. Recommended: yes; confirm.
- **[ADR-4] Hardware protocol shape.** Exact byte/line framing of the `BLOCK` /
  `RETRIEVE` / `STATUS` protocol is frozen at implementation. Confirm frame
  format and whether responses require checksums for a student-project
  reliability bar.
- **[ADR-5] Session end during an in-progress BLOCK.** Whether the backend
  forces a final `RETRIEVE` at session end when the arm is mid-action or
  blocked. Recommended: yes, force RETRIEVE; confirm the desired end state.
- **[ADR-6] Mongo-out behavior.** Spec requires Mongo persistence (FR-12) but
  doesn't say what happens if Mongo is down at runtime: (a) fail hard with
  clear errors (recommended, simplest and reliable), or (b) buffer writes
  in-memory and flush on recovery.
- **[ADR-7] Auth between local services.** Optional shared secret between
  Python→backend and dashboard→backend. Default (recommended): no auth on
  localhost. Confirm.
- **[ADR-8] Servo-to-joint assignment.** Spec lists 3× MG996R + 3× SG90 for a
  4‑DOF arm; how the six servos map to joints and the gripper is a mechanical
  decision to confirm with the physical build.
- **[ADR-9] Settings scope.** Spec says the dashboard exposes
  "settings/statistics" (FR-25). Confirm which settings users may edit live
  (e.g., slouch margin, hold durations) versus fixed at build time.
- **[ADR-10] Serving the app.** Confirm the demo serves the built dashboard
  from Express (recommended) rather than a separate Vite dev-server process.