import { useCallback, useEffect, useState } from 'react';
import * as sessionApi from '../api/sessions';

function defaultPollIntervalMs() {
  return Number(import.meta.env.VITE_SESSION_POLL_INTERVAL_MS) || 5000;
}

export function useSession(api = sessionApi, { pollIntervalMs = defaultPollIntervalMs() } = {}) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [baselineBusy, setBaselineBusy] = useState(false);
  const [error, setError] = useState(null);
  const [baselineError, setBaselineError] = useState(null);

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

  const startSession = useCallback(async (friendlyName) => {
    setBusy(true);
    setError(null);
    try {
      await api.createSession(friendlyName);
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

  const captureBaseline = useCallback(async () => {
    if (!session) return;
    setBaselineBusy(true);
    setBaselineError(null);
    try {
      await api.captureBaseline();
      await refresh();
    } catch (err) {
      setBaselineError(err.message);
    } finally {
      setBaselineBusy(false);
    }
  }, [api, session, refresh]);

  const resetBaseline = useCallback(async () => {
    if (!session) return;
    setBaselineBusy(true);
    setBaselineError(null);
    try {
      await api.resetBaseline();
      await refresh();
    } catch (err) {
      setBaselineError(err.message);
    } finally {
      setBaselineBusy(false);
    }
  }, [api, session, refresh]);

  return {
    session,
    loading,
    busy,
    baselineBusy,
    error,
    baselineError,
    startSession,
    endActiveSession,
    captureBaseline,
    resetBaseline,
    refresh,
  };
}