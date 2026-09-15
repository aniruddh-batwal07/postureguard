import { useCallback, useEffect, useState } from 'react';
import * as eventsApi from '../api/events';

function defaultPollIntervalMs() {
  return Number(import.meta.env.VITE_EVENT_POLL_INTERVAL_MS) || 2000;
}

export function useSessionEvents(
  sessionId,
  api = eventsApi,
  { pollIntervalMs = defaultPollIntervalMs(), poll = Boolean(sessionId) } = {},
) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!sessionId || !poll) {
      setEvents([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const list = await api.getEvents(sessionId);
      setEvents(list);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [api, sessionId, poll]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (pollIntervalMs <= 0 || !poll) {
      return undefined;
    }
    const id = setInterval(() => refresh(), pollIntervalMs);
    return () => clearInterval(id);
  }, [refresh, pollIntervalMs, poll]);

  return { events, loading, error };
}