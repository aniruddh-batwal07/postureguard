"""HTTP client that posts detection events to the PostureGuard backend."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any


class EventClientError(RuntimeError):
    """Raised when the backend rejects or cannot be reached for an event."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class EventClient:
    """Posts events to ``POST /api/events`` (see architecture.md §4.2)."""

    def __init__(self, base_url: str, timeout: float = 5.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    @property
    def base_url(self) -> str:
        return self._base_url

    def request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        url = f"{self._base_url}{path}"
        headers = {}
        body = None
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                data = resp.read()
                return json.loads(data) if data else {}
        except urllib.error.HTTPError as err:
            detail = ""
            try:
                detail = err.read().decode("utf-8", "replace")
            except Exception:
                pass
            raise EventClientError(
                f"{method} {url} failed with status {err.code}: {detail}"
            ) from err
        except urllib.error.URLError as err:
            raise EventClientError(f"{method} {url} failed: {err.reason}") from err

    def send_event(
        self,
        event_type: str,
        session_id: str,
        data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Send one detection event to the backend.

        The envelope matches architecture.md §4.2: type, sessionId, timestamp,
        and optional data. Returns the parsed backend response body.
        """
        event: dict[str, Any] = {
            "type": event_type,
            "sessionId": session_id,
            "timestamp": _utc_now(),
        }
        if data is not None:
            event["data"] = data
        return self.request("POST", "/api/events", event)