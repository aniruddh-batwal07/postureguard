# PostureGuard — Screen Blocker Arm

Product Specification

- **Source of truth:** PostureGuard project description (as supplied by the project owner)
- **Document status:** Draft for review
- **Architecture tier:** Browser-based web application (not a native desktop application)

---

## 1. Product Overview

PostureGuard is a smart desktop system designed to reduce poor posture and
distracting phone usage while working on a laptop. It combines computer vision,
AI, IoT, robotics, and a web dashboard to automatically detect posture
violations and phone distraction, record the events, and physically block the
laptop screen with a robotic arm until the user corrects their behavior.

The system runs on the user's laptop. A webcam-based Python computer vision
pipeline continuously monitors the user. When a violation is confirmed, the
backend is notified, the event is persisted in MongoDB, and the robotic arm
(retrofit hardware controlled by an Arduino) picks up a blocker card, positions
it in front of the laptop screen, and keeps it there until the user resumes
correct posture or stops using the phone. A React dashboard gives the user a
live view of posture, violations, blocking status, and history.

**One‑sentence summary:** PostureGuard is an AI-powered productivity system that
detects poor posture and phone distraction through a webcam, records violations,
and automatically uses a robotic arm to physically block the laptop screen until
the user corrects their behavior.

---

## 2. Problem Being Solved

- **Poor posture while working:** Users slouch while working on a laptop, which
  leads to back, neck, and shoulder strain over time. Passive reminders are
  easily ignored.
- **Phone distraction:** Frequent phone use interrupts focused work and reduces
  productivity.
- **Ineffectiveness of passive feedback:** Notifications and vibration alerts
  are easy to dismiss and do not force a behavior change.
- **Posture is personal:** Correct posture varies by person, so the system
  personalizes detection via a per-session baseline rather than a one-size-fits
  -all threshold.

PostureGuard addresses these by actively enforcing good behavior: the screen is
physically blocked until the user corrects their posture or puts the phone away,
making the corrective action immediately and physically salient.

---

## 3. User Flow — From Starting a Session to Correction

1. **Start a session.** The user opens the PostureGuard dashboard (web app) and
   starts a monitoring session.
2. **Establish baseline.** The user sits upright for a few seconds while the
   webcam streams video. The Python computer vision module captures this
   upright pose and establishes the user's personalized posture baseline for
   the session.
3. **Continuous monitoring.** The webcam keeps capturing video. The Python
   module continuously evaluates:
   - pose (posture) via MediaPipe Pose, and
   - phone + hand interaction via YOLOv8 Nano with MediaPipe Hands.
4. **Violation detection.** The module flags a violation only when a condition
   persists for a defined duration (debounce/timer logic), preventing false
   triggers:
   - **Slouching:** posture remains significantly below the baseline for a
     defined duration.
   - **Phone usage:** phone + hand interaction remains detected for a defined
     duration.
5. **Violation reported.** On confirmation, Python sends the violation to the
   Node.js/Express backend, which validates the event, stores it in MongoDB,
   communicates with the robotic system, and updates the dashboard.
6. **Screen blocking.** The backend sends a `BLOCK` command to the Arduino.
   The robotic arm picks up the lightweight blocker card from its dock, moves
   it in front of the laptop screen, and physically blocks the screen. The card
   displays the message **“Fix your posture.”**
7. **Correction monitoring continues.** While the screen is blocked, the Python
   system keeps monitoring the user. When the user maintains correct posture or
   stops using the phone for the required duration, a correction request is
   sent to the backend.
8. **Screen unblocking.** The backend sends a `RETRIEVE` command to the
   Arduino. The arm retrieves the card, returns it to its dock, and the screen
   becomes accessible again.
9. **Session data.** Violations, corrections, and blocking events are recorded
   and shown in the dashboard (event history and statistics), and the user may
   end the session at any time.

---

## 4. Functional Requirements

### 4.1 Session management
- FR-01 — The user can start and stop a monitoring session from the dashboard.
- FR-02 — On session start, the system captures an upright posture baseline for
  the current user/session.
- FR-03 — The system exposes the current session's status (monitoring, blocked,
  idle).

### 4.2 Vision-based detection (Python)
- FR-04 — The webcam feed is continuously captured while a session is active.
- FR-05 — Posture is detected using MediaPipe Pose.
- FR-06 — Phone use is detected using YOLOv8 Nano combined with MediaPipe Hands.
- FR-07 — A slouch violation is emitted when posture remains significantly below
  the baseline for a defined duration.
- FR-08 — A phone-use violation is emitted when phone + hand interaction remains
  detected for a defined duration.
- FR-09 — Timer/debounce logic prevents false triggers (a transient deviation
  alone does not create a violation).

### 4.3 Backend processing (Node.js/Express)
- FR-10 — The backend receives violation and correction events from the Python
  module.
- FR-11 — The backend validates incoming events before acting on them.
- FR-12 — The backend persists validated events in MongoDB.
- FR-13 — The backend dispatches `BLOCK` / `RETRIEVE` commands to the Arduino
  controller.
- FR-14 — The backend pushes state updates to the dashboard.

### 4.4 Robotic screen blocking (Arduino)
- FR-15 — On `BLOCK`, the arm picks the blocker card from its dock and positions
  it in front of the laptop screen.
- FR-16 — On `RETRIEVE`, the arm returns the card to its dock.
- FR-17 — The arm motion is controlled via servo motors through a PCA9685 servo
  driver.
- FR-18 — Movement commands are executed atomically (a blocking or unblocking
  action completes reliably).

### 4.5 Dashboard (React + Vite)
- FR-19 — Shows current monitoring status.
- FR-20 — Shows live posture information.
- FR-21 — Shows violations, including type (slouch vs phone) and timestamps.
- FR-22 — Shows screen-blocking status.
- FR-23 — Shows event history.
- FR-24 — Shows session information.
- FR-25 — Shows settings and statistics.

---

## 5. Software Components

```
Laptop Webcam
      ↓
Python CV + AI          React + Vite Dashboard
      ↓                          ↑
Node.js/Express Backend ─────────┘
      ↙                 ↘
 MongoDB            Arduino Controller
                          ↓
                    Robotic Arm
                          ↓
                    Screen Blocking
```

### 5.1 Python computer vision + AI module
- Captures laptop webcam video.
- Runs MediaPipe Pose for posture detection.
- Runs YOLOv8 Nano + MediaPipe Hands for phone-use detection.
- Implements baseline capture, violation timers/debounce, and the rules that
  decide when a violation or correction is confirmed.
- Sends violation/correction events to the Node.js/Express backend.

### 5.2 Node.js/Express backend
- Public-facing HTTP API for the Python module and the dashboard.
- Validates incoming violation/correction events.
- Persists events in MongoDB.
- Manages session state.
- Dispatches `BLOCK` / `RETRIEVE` commands to the hardware controller.
- Pushes state updates to the React dashboard.

### 5.3 Database — MongoDB
- Stores sessions, violations, corrections, blocking events, and dashboard
  statistics.

### 5.4 Frontend — React + Vite dashboard
- Browser-based user interface for monitoring, history, settings, and
  statistics (see FR-19 through FR-25).

### 5.5 Edge/embedded controller firmware
- Runs on the Arduino; receives commands from the backend and drives the
  robotic arm.

---

## 6. Hardware Components

- **Laptop webcam** — video source for posture and phone detection.
- **Arduino** — hardware controller (explicitly Arduino, NOT ESP32).
- **4‑DOF robotic arm** — performs screen blocking/unblocking.
- **6 servo motors** — 3 × MG996R + 3 × SG90 drive the arm (as specified in the
  project description).
- **PCA9685 servo driver** — controls the arm servos.
- **Blocker card + dock** — the lightweight card that physically blocks the
  screen; it carries the message **“Fix your posture.”** and docks when idle.
- **Power supply** — powers the controller, servo driver, and servos.
- **Additional supporting hardware** — mounting, linkage, cabling, and
  structural parts required to assemble the arm and place it relative to the
  laptop (exact list to be finalized during the build).

---

## 7. Data and Event Flow

1. **Baseline:** On session start, the Python module captures the user's upright
   pose from the webcam and stores it as the session baseline (kept in memory /
   session context).
2. **Detection:** The Python module continuously runs pose and phone detection;
   its timer/debounce logic decides whether to raise an event.
3. **Violation event (Python → Backend):** On confirmation, Python POSTs the
   violation (type, timestamp, and any associated posture/confidence data) to
   the backend.
4. **Validation & persistence (Backend):** The backend validates the event and
   inserts a document into MongoDB.
5. **Blocking (Backend → Arduino):** The backend sends a `BLOCK` command to the
   Arduino. The arm picks the card from the dock and places it in front of the
   screen. The dashboard's blocking status is updated.
6. **Correction event (Python → Backend):** While blocked, Python keeps
   monitoring. When the corrected behavior persists for the required duration,
   it posts a correction request to the backend.
7. **Unblocking (Backend → Arduino):** The backend sends a `RETRIEVE` command;
   the arm returns the card to its dock. The dashboard's blocking status is
   updated.
8. **Dashboard updates:** The backend keeps the React dashboard in sync — live
   posture info, monitoring status, blocking status, event history, and
   statistics, all read from MongoDB and/or live state.

Key events: `session_start`, `baseline_captured`, `slouch_violation`,
`phone_violation`, `block_sent`, `screen_blocked`, `correction_requested`,
`retrieve_sent`, `screen_unblocked`, `session_end`.

---

## 8. Technology Choices Already Decided

| Concern | Decision |
|---|---|
| Application tier | Browser-based web application (NOT native desktop) |
| Frontend | React + Vite |
| Computer vision / AI | Python (MediaPipe Pose; YOLOv8 Nano + MediaPipe Hands) |
| Backend | Node.js / Express |
| Database | MongoDB |
| Hardware controller | Arduino (NOT ESP32) |
| Servo driver | PCA9685 |
| Robotic arm DOF | 4‑DOF |
| Servos | 3 × MG996R + 3 × SG90 |
| Screen-blocking mechanism | Blocker card moved by the robotic arm |

---

## 9. Scope — What We Will Build

- A web-app dashboard (React + Vite) for session control, live monitoring,
  history, and statistics.
- A Python computer vision module using MediaPipe Pose and YOLOv8 Nano +
  MediaPipe Hands for posture and phone detection, including baseline capture
  and debounced violation/correction logic.
- A Node.js/Express backend API that validates and persists events in MongoDB
  and coordinates hardware commands.
- Arduino firmware that receives `BLOCK` / `RETRIEVE` commands and drives the
  4‑DOF robotic arm through the PCA9685 servo driver.
- Physical assembly of the robotic arm, blocker card, dock, and power supply so
  the arm can physically block and unblock the laptop screen.
- End-to-end flow: detection → violation → blocking → correction → unblocking,
  with event history and statistics on the dashboard.

---

## 10. Explicit Non-Goals — What We Will NOT Build

- **No native or mobile desktop application.** This is a browser-based web
  application only.
- **No other hardware controllers.** The hardware controller is Arduino only;
  no ESP32 or other MCU variants.
- **No gameplay, gamification, or social features** (no leaderboards, streaks,
  sharing, etc.).
- **No mobile phone sensor application.** Phone detection is done exclusively
  via webcam computer vision, not via an app on the phone itself.
- **No cloud/remote deployment.** The system runs locally on the user's laptop;
  no multi-user accounts, authentication, or cloud hosting.
- **No smart-home or other IoT integrations.**
- **No non-posture / non-phone user analytics.** No additional biometric
  detection (e.g., gaze, heart rate, emotion) beyond what is required for
  posture and phone detection.
- **No fully autonomous "AI coaching"** beyond the defined violation/correction
  loop. No chat assistants or generated feedback content.
- **No manufacturing or packaging of the hardware** as a sellable product; the
  hardware is a one-off retrofit for a laptop workspace.

---

## 11. Important Constraints and Assumptions

### Constraints (decided)
- Browser-based web application, not a native desktop application.
- Frontend: React + Vite. Computer vision: Python. Backend: Node.js/Express.
  Database: MongoDB.
- Hardware controller: Arduino — explicitly NOT ESP32.
- Computer vision uses MediaPipe Pose (posture) and YOLOv8 Nano + MediaPipe
  Hands (phone use).
- Servo driver: PCA9685; arm: 4‑DOF; servos: 3 × MG996R + 3 × SG90.
- Blocker card message is fixed: **“Fix your posture.”**

### Assumptions (made because the source description was incomplete or
inconsistent; to be confirmed before build)
- **Arduino vs ESP32:** The supplied project description refers to an ESP32
  (and WebSocket communication) in several places, but the explicit project
  constraint states the controller is Arduino (NOT ESP32). This document treats
  the explicit constraint as authoritative and uses Arduino throughout.
  Consequently, the backend→controller transport is **assumed to be a wired/USB
  serial link** rather than ESP32 Wi-Fi WebSocket; the exact link type and the
  specific Arduino model (e.g., Uno/Mega) are to be confirmed during design.
- **“ARDINO” / “ARDIO\NO”** in the description are assumed to be typos for
  Arduino.
- **Servo count:** The description specifies 3 × MG996R + 3 × SG90 = 6 servos
  for a 4‑DOF arm. The extra servos are assumed to serve the gripper/end
  effector and/or wrist; the exact joint assignment is left to mechanical
  design.
- **Additional hardware** is intentionally unspecified ("some other hardware
  components also"); assumed to be structural/mounting/cabling items finalized
  during the build.
- **Violation thresholds and durations** (how far below baseline, how long the
  condition must persist, the required correction duration) are intended to be
  configurable; concrete default values are to be defined during implementation.
- **Baseline is per-session:** captured each time a session starts; the
  description does not specify persistent user profiles.
- **Single-user, single-session** operation on one laptop/workspace; no
  multi-user support is implied or planned.
- **Live posture data** and statistics shown on the dashboard come from
  MongoDB records and backend state; the exact refresh mechanism (polling vs
  push) is an implementation detail not constrained by the description.