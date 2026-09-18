"""Live M3.3 verification probe (real backend + real Mongo + real HTTP).

Runs inside WSL against the running backend at http://127.0.0.1:4000.
Proves the core M3.3 contract: a running CV-side settings poller picks up a
settings change pushed via PUT /api/settings WITHOUT restarting the process.

Usage:
    cd cv && .venv/bin/python test/live_settings_probe.py

Exits 0 on success, 1 on any failure.
"""

from __future__ import annotations

import sys
import time
import urllib.request

from cv.events import EventClient
from cv.settings import CvSettings, SettingsPoller

BACKEND_URL = "http://127.0.0.1:4000"
POLL_INTERVAL = 2.0

NEW_SETTINGS = {
    "slouchThreshold": 0.31,
    "slouchDurationSeconds": 4.0,
    "correctionDurationSeconds": 2.5,
}
DEFAULTS = {
    "slouchThreshold": 0.15,
    "slouchDurationSeconds": 2.0,
    "correctionDurationSeconds": 2.0,
}


def put_settings(patch: dict) -> dict:
    body = __import__("json").dumps(patch).encode("utf-8")
    req = urllib.request.Request(
        f"{BACKEND_URL}/api/settings",
        data=body,
        method="PUT",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return __import__("json").loads(resp.read().decode("utf-8"))


def main() -> int:
    # Reset the backend document so the probe starts from known defaults.
    put_settings(DEFAULTS)

    client = EventClient(BACKEND_URL)
    poller = SettingsPoller(
        client,
        initial_settings=CvSettings(),
        poll_interval_seconds=POLL_INTERVAL,
    )

    changed = poller.poll()
    print(f"[live] initial poll changed={changed} settings={poller.current_settings}", flush=True)

    print(f"[live] PUT /api/settings {NEW_SETTINGS}", flush=True)
    resp = put_settings(NEW_SETTINGS)
    print(f"[live] PUT response: {resp}", flush=True)

    time.sleep(POLL_INTERVAL + 0.5)
    changed2 = poller.poll()
    print(f"[live] second poll changed={changed2} settings={poller.current_settings}", flush=True)

    s = poller.current_settings
    if not changed2 or s.slouchThreshold != NEW_SETTINGS["slouchThreshold"]:
        print("[live] FAIL: running poller did not pick up the new settings", file=sys.stderr)
        return 1

    # Restore defaults so we leave the backend clean.
    put_settings(DEFAULTS)
    time.sleep(POLL_INTERVAL + 0.5)
    poller.poll()
    print(f"[live] restored defaults: {poller.current_settings}", flush=True)
    print("[live] OK: settings reached the running CV poller without restart", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())