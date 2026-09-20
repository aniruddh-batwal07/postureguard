import { useCallback, useEffect, useState } from 'react';
import * as sessionApi from '../api/sessions';

function defaultPollIntervalMs() {
  return Number(import.meta.env.VITE_SESSION_POLL_INTERVAL_MS) || 5000;
}

const BASELINE_STORAGE_KEY = 'postureguard_saved_baseline';

function loadStoredBaseline() {
  try {
    const raw = localStorage.getItem(BASELINE_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveStoredBaseline(baseline) {
  try {
    if (baseline && typeof baseline === 'object') {
      localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(baseline));
    }
  } catch {
    // Ignore quota or security errors
  }
}

function clearStoredBaseline() {
  try {
    localStorage.removeItem(BASELINE_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export function useSession(api = sessionApi, { pollIntervalMs = defaultPollIntervalMs() } = {}) {
  const [session, setSession] = useState(null);
  const [savedBaseline, setSavedBaseline] = useState(() => loadStoredBaseline());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [baselineBusy, setBaselineBusy] = useState(false);
  const [error, setError] = useState(null);
  const [baselineError, setBaselineError] = useState(null);

  // Automatically save baseline to localStorage whenever session has a configured baseline
  useEffect(() => {
    if (session && session.baselineState === 'configured' && session.baseline) {
      saveStoredBaseline(session.baseline);
      setSavedBaseline(session.baseline);
    }
  }, [session]);

  const handleClearSavedBaseline = useCallback(() => {
    clearStoredBaseline();
    setSavedBaseline(null);
  }, []);

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
      const stored = loadStoredBaseline();
      if (stored) {
        await api.createSession({
          friendlyName: typeof friendlyName === 'string' ? friendlyName : undefined,
          baseline: stored,
        });
      } else {
        await api.createSession(friendlyName);
      }
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
    savedBaseline,
    clearSavedBaseline: handleClearSavedBaseline,
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