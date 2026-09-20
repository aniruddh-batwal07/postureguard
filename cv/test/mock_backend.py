"""Minimal fake of the PostureGuard backend for Python contract tests."""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread


class MockBackend:
    def __init__(self) -> None:
        self.requests = []
        self.events = []
        self.active_session = {
            "id": "session-1",
            "state": "active",
            "baselineState": "unconfigured",
            "baseline": None,
        }

        self.session_counter = 1
        self.events_status = 201
        # M3.3: current settings returned by GET /api/settings
        self.settings = {
            "slouchThreshold": 0.15,
            "slouchDurationSeconds": 2.0,
            "correctionDurationSeconds": 2.0,
        }
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), self._make_handler())
        self.base_url = f"http://127.0.0.1:{self._server.server_address[1]}"
        thread = Thread(target=self._server.serve_forever, daemon=True)
        thread.start()

    def route(self, method, path, payload=None):
        if (method, path) == ("GET", "/api/status"):
            return 200, {"status": "ok", "service": "postureguard-backend"}
        if (method, path) == ("GET", "/api/sessions/active"):
            if hasattr(self, "sessions_status") and self.sessions_status != 200:
                return self.sessions_status, {"error": "backend error"}
            return 200, {"session": self.active_session}

        if (method, path) == ("POST", "/api/sessions"):
            self.session_counter += 1
            self.active_session = {
                "id": f"session-{self.session_counter}",
                "state": "active",
                "baselineState": "unconfigured",
                "baseline": None,
            }
            return 201, {"session": self.active_session}
        if (method, path) == ("POST", "/api/events"):
            if payload and payload.get("type") == "baseline_captured" and self.active_session:
                self.active_session["baselineState"] = "configured"
                self.active_session["baseline"] = payload.get("data")
            evt = self.events[-1] if self.events else {}
            event = {
                "id": f"ev-{len(self.events)}",
                "sessionId": evt.get("sessionId"),
                "type": evt.get("type"),
                "timestamp": evt.get("timestamp"),
            }
            return self.events_status, {"event": event}

        if (method, path) == ("GET", "/api/settings"):
            return 200, {"settings": self.settings}
        if method == "PUT" and path == "/api/settings":
            if payload and isinstance(payload, dict):
                self.settings = {**self.settings, **payload}
            return 200, {"settings": self.settings}
        return 404, {"error": "Not Found"}

    def _make_handler(self):
        backend = self

        class Handler(BaseHTTPRequestHandler):
            def _handle(self):
                length = int(self.headers.get("Content-Length", 0) or 0)
                body = self.rfile.read(length).decode("utf-8") if length else ""
                payload = json.loads(body) if body else None
                backend.requests.append((self.command, self.path, payload))
                if self.path == "/api/events" and payload:
                    backend.events.append(payload)
                status, data = backend.route(self.command, self.path, payload)
                encoded = json.dumps(data).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def do_GET(self):
                self._handle()

            def do_POST(self):
                self._handle()

            def do_PUT(self):
                self._handle()

            def log_message(self, *args):
                pass

        return Handler

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()