"""Backend event client for the PostureGuard CV service."""

from cv.events.client import EventClient, EventClientError

__all__ = ["EventClient", "EventClientError"]