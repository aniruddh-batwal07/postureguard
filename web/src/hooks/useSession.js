import { useCallback, useEffect, useState } from 'react';
import * as sessionApi from '../api/sessions';

function defaultPollIntervalMs() {
  return Number(import.meta.env.VITE_SESSION_POLL_INTERVAL_MS) || 5000;
}

export function useSession(api = sessionApi, { pollIntervalMs = defaultPollIntervalMs() } = {}) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const active = await api.getActiveSession();
      setSession(active);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (pollIntervalMs <= 0) {
      return undefined;
    }
    const id = setInterval(() => refresh(), pollIntervalMs);
    return () => clearInterval(id);
  }, [refresh, pollIntervalMs]);

  const startSession = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.createSession();
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [api, refresh]);

  const endActiveSession = useCallback(async () => {
    if (!session) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.endSession(session.id);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [api, session, refresh]);

  return { session, loading, busy, error, startSession, endActiveSession };
}