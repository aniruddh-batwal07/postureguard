# PostureGuard

An AI-powered productivity system that detects poor posture and phone
distraction through a webcam, records violations, and automatically uses a
robotic arm to physically block the laptop screen until the user corrects
their behavior.

**Status:** Milestone M0.1 — monorepo scaffold + tooling only. No product
functionality is implemented yet. See `docs/development-plan.md`.

## Repository layout

```
postureguard/
├── backend/               # Node.js + Express service
├── cv/                    # Python computer vision service (src layout)
├── web/                   # React + Vite dashboard
├── firmware/              # Arduino firmware (Phase 5)
├── hardware/              # BOM / wiring / assembly notes
├── docs/                  # product-spec.md, architecture.md, development-plan.md
├── docker-compose.yml     # MongoDB container (MongoDB is never installed on the host)
└── .env.example           # environment variable template
```

## Prerequisites

- Node.js 20+, Python 3.10+, Docker with the Compose plugin.

## Getting started

1. Start MongoDB (Docker container, bound to `127.0.0.1`):

   ```sh
   docker compose up -d
   ```

2. Copy the environment template (optional — defaults already match it):

   ```sh
   cp .env.example .env
   ```

3. Start each software service:

   ```sh
   # Backend (Node.js/Express)
   cd backend
   npm install
   npm run dev        # http://127.0.0.1:4000/api/status

   # Dashboard (React + Vite)
   cd web
   npm install
   npm run dev        # http://127.0.0.1:5173

   # Computer vision service (Python)
   cd cv
   pip install -e .
   python -m cv
   ```

## Health checks

- Backend: `GET http://127.0.0.1:4000/api/status` returns `{"status":"ok", ...}`.
- Dashboard: `http://127.0.0.1:5173` serves the scaffold page.
- CV service: `python -m cv` prints a service-OK line.

## Local system notes

- All processes bind to `127.0.0.1` only (MongoDB included).
- No authentication between local services (ADR-7 default: none).
- The demo-serving model is still open (ADR-10); dev servers run separately for
  now.
- MongoDB runs exclusively as a Docker container via `docker compose`; it is
  not installed on the host.