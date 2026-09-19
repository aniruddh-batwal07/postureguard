# M4.2 — Full block/correct/unblock loop with the mock arm

Vertical-slice report. Objective from `docs/development-plan.md`: a slouch
violation drives the (mock) arm to the screen, the dashboard shows
card-at-screen status, and a correction clears it — with zero physical hardware.

## What the loop is

```
CV / API clients                    Backend                        Mock arm (fake serial device)
───────────────                    ────────                        ─────────────────────────────
POST /api/sessions           → session baseline_capturing
POST /api/events baseline_captured → session monitoring (FSM only, no arm)
POST /api/events slouch_violation → event stored (201)
                                   → events service calls blockSession()
                                   → session blocking → BLOCK ──────→ BLOCK_OK
                                   → session blocked (dashboard: blocked + "Fix your posture.")
POST /api/events correction_requested → event stored (201)
                                   → events service calls retrieveSession()
                                   → session unblocking → RETRIEVE ─→ RETRIEVE_OK
                                   → session monitoring
```

The backend remains the single source of truth for state. A failed baseline (no
`baseline_captured` posted) leaves the session `baseline_capturing` forever — it
can never be blocked. The `BLOCK`/`RETRIEVE` protocol, command serialization,
timeouts and error semantics are untouched from M4.1 (`backend/src/hardware/service.js`
+ the FSM in `backend/src/sessions/`).

## What changed

Backend — event ingestion now drives the session/hardware layer
(`backend/src/events/service.js`, `backend/src/app.js`):

- `createEventService` accepts three optional callbacks: `blockSession`,
  `retrieveSession` and `markBaselineCaptured`.
- After an event is persisted, a `slouch_violation` dispatches
  `blockSession(sessionId)`; a `correction_requested` dispatches
  `retrieveSession(sessionId)`; a `baseline_captured` dispatches
  `markBaselineCaptured(sessionId)`.
- The event stays authoritative — the API still answers `201 { event }` even when
  the hardware action cannot run. Duplicate events (`INVALID_TRANSITION`, e.g. a
  second violation while already blocked) and `HARDWARE_*` failures (unavailable,
  timeout, device error, protocol error) are logged and swallowed so they never
  break event ingestion. Unexpected errors still propagate to the 500 handler.
- `createApp` wires `blockSession`/`retrieveSession` only when a `hardware`
  object is supplied; with no hardware the event service degrades to recording
  events only (fail-safe: it never pretends to block). `markBaselineCaptured` is
  wired **unconditionally** — moving a `baseline_capturing` session to
  `monitoring` is pure session FSM and touches no hardware.
- Ending a session while the arm may be engaged forces a final `RETRIEVE`
  (ADR-5) — already in place from M4.1 and now covered by M4.2 tests.

Dashboard (`web/src/App.jsx`):

- New state labels `blocking` (`Blocking screen — moving card into view`) and
  `unblocking` (`Restoring screen — removing card`) in `STATE_LABELS`.
- A prominent **Fix your posture.** message is rendered while the session is
  `blocked`, and disappears once polling reports the recovery to `monitoring`.

CV (`cv/src/cv/__main__.py`):

- After a successful baseline capture the CV forwards a `baseline_captured`
  event (new `EVENT_BASELINE_CAPTURED` constant) to the backend; the session
  FSM moves it from `baseline_capturing` to `monitoring`. A failed capture
  raises before the event is posted, so the session stays `baseline_capturing`
  and never blocks. Forwarding is best-effort (M3.1): if the backend is
  unreachable the CV keeps monitoring and only logs the failure.

## Tests

New, Mongo-free and webcam-free:

- `backend/test/event-hardware-flow.test.js` — service-level composition of the
  events service, session service, hardware service and `FakeSerialDevice`
  (deterministic deferred mode). Covers: exactly one `BLOCK` from `monitoring`
  → `blocked`; exactly one `RETRIEVE` from `blocked` → `monitoring`; BLOCK
  failure (`ERROR_STALL`) or timeout → event still recorded, session falls back
  to `monitoring`; duplicate violations while blocked persist without a second
  `BLOCK`; duplicate corrections while monitoring persist without a `RETRIEVE`;
  RETRIEVE failure → stays `blocked`; unknown session → `SessionNotFoundError`
  with nothing sent to the arm; ADR-5 final `RETRIEVE` on end-of-session while
  blocked; no-hardware event service records without hardware actions;
  `baseline_captured` moving a `baseline_capturing` session to `monitoring`
  before the violation path runs; a stray `baseline_captured` while already
  `monitoring` persisting without changing anything; a session that never
  receives `baseline_captured` staying `baseline_capturing` (failed baseline).
- `backend/test/hardware-loop.integration.test.js` — full HTTP app via
  `createApp` with `createApp({ persistence, hardware })`, using an in-memory
  mongo-shaped persistence (`backend/test/helpers/in-memory-db.js`) and the fake
  serial device. Proves the loop over the real routers: violation → `[BLOCK]` +
  session `blocked`; duplicate → still one `BLOCK`; correction → `[BLOCK,
  RETRIEVE]` + `monitoring`; `POST /api/sessions/:id/end` transitions to `ended`
  (and from `blocked` sends the final `RETRIEVE`); a silent blast of two events
  is queryable in chronological order. Plus the **real session flow** over the
  live API: `POST /api/sessions` → `baseline_capturing`; `baseline_captured` →
  `monitoring`; violation on that real session → exactly one `BLOCK` → `blocked`;
  correction → exactly one `RETRIEVE` → `monitoring`; `end` → `ended`. A failed
  baseline (no `baseline_captured` posted) keeps the session `baseline_capturing`
  with zero arm commands even if a violation arrives early.
- `backend/test/event.integration.test.js` — Mongo-backed proof that
  `POST /api/events baseline_captured` transitions a real persisted
`baseline_capturing` session to `monitoring` (requires the local MongoDB, as do
the other Mongo integration tests).
- `cv/test/test_service.py` — the run-loop contract now expects
  `baseline_captured` to be forwarded first after a successful capture, then
  `slouch_violation` / `correction_requested` as before; upright-only loops
  forward exactly the single `baseline_captured` event.
- `web/test/App.test.jsx` — the state-label test now covers `blocking` and
  `unblocking`, plus a new poll-driven test asserting **Fix your posture.**
  appears while `blocked` and clears after recovery to `monitoring`.

## Verification

| Suite | Result |
| --- | --- |
| Backend `npm test` | 204 pass, 0 fail, 0 skip (incl. Mongo integration — a local MongoDB was reachable during this run) |
| Web `vitest run` | 29 pass, 0 fail |
| Web production build (`vite build`) | OK (38 modules) |
| CV `pytest` | 122 pass, 5 fail — the 5 failures are the `smoke`-marked camera tests (no webcam in this WSL environment), unchanged from baseline |

No regressions outside M4.2; every pre-existing backend/web test still passes.

## Demo

Scripted walkthrough (used as the demo since no webcam exists here):

```sh
cd backend && node --env-file-if-exists=../.env --test test/hardware-loop.integration.test.js
cd web && npm test
```

`backend/test/hardware-loop.integration.test.js` prints the full cycle — violation,
arm `BLOCK`, dashboard `blocked` + **Fix your posture.**, correction, arm
`RETRIEVE`, `monitoring`, end.

## Known limitations

- **Real-webcam demo blocked by environment.** WSL exposes no camera
  (`cv2.VideoCapture(0)` opens `False`; the camera smoke tests fail with
  "Camera index out of range"). The Live Windows-host webcam walkthrough from the
  plan could not run here; the deterministic mock-arm loop stands in for it and
  exercises the identical backend + dashboard path.
- The dashboard does not yet display a dedicated baseline-capturing status panel
  beyond the session `state` (`baseline_capturing`); the `baseline_captured`
  event is intentionally not shown in the event-history label map. Cosmetic
  follow-up.

## Next steps (unchanged scope)

Phone detection, real firmware + serial driver (Phase 5, where the mock is
swapped for the Arduino and `blocking → blocked` uses the real arm), and Phase 6
final integration.