import { useCallback, useEffect, useState } from 'react';
import * as statisticsApi from '../api/statistics';

function defaultPollIntervalMs() {
  return Number(import.meta.env.VITE_STATISTICS_POLL_INTERVAL_MS) || 5000;
}

export function useSessionStatistics(
  sessionId,
  api = statisticsApi,
  { pollIntervalMs = defaultPollIntervalMs(), poll = Boolean(sessionId) } = {},
) {
  const [statistics, setStatistics] = useState(null);
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!sessionId || !poll) {
      setStatistics(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const stats = await api.getStatistics(sessionId);
      setStatistics(stats);
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

  return { statistics, loading, error };
}