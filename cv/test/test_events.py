import socket
from datetime import datetime

import pytest

from cv.events import EventClient, EventClientError
from mock_backend import MockBackend


@pytest.fixture
def backend():
    server = MockBackend()
    yield server
    server.close()


def test_send_event_posts_documented_envelope(backend):
    client = EventClient(backend.base_url)
    result = client.send_event("session_start", "abc-123")
    assert result["accepted"] is True
    received = backend.events[0]
    assert received["type"] == "session_start"
    assert received["sessionId"] == "abc-123"
    datetime.fromisoformat(received["timestamp"].replace("Z", "+00:00"))
    assert "data" not in received


def test_send_event_includes_optional_data(backend):
    client = EventClient(backend.base_url)
    client.send_event("baseline_captured", "abc-123", data={"metric": 0.9})
    assert backend.events[0]["data"] == {"metric": 0.9}


def test_send_event_raises_on_non_2xx_response(backend):
    backend.events_status = 500
    client = EventClient(backend.base_url)
    with pytest.raises(EventClientError, match="500"):
        client.send_event("session_start", "abc-123")


def test_send_event_raises_when_backend_unreachable():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    client = EventClient(f"http://127.0.0.1:{port}", timeout=0.5)
    with pytest.raises(EventClientError, match="failed"):
        client.send_event("session_start", "abc-123")


def test_request_reads_json_response(backend):
    client = EventClient(backend.base_url)
    assert client.request("GET", "/api/status")["status"] == "ok"