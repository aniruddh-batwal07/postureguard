import { useCallback, useEffect, useState } from 'react';
import * as sessionApi from '../api/sessions';

function defaultPollIntervalMs() {
  return Number(import.meta.env.VITE_HISTORY_POLL_INTERVAL_MS) || 10000;
}

export function useSessionHistory(
  api = sessionApi,
  { pollIntervalMs = defaultPollIntervalMs(), limit = 20 } = {},
) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const list = await api.getSessionHistory(limit);
      setHistory(list);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [api, limit]);

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

  return { history, loading, error, refresh };
}
