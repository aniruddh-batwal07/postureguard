import { useCallback, useEffect, useState } from 'react';
import * as settingsApi from '../api/settings';

/**
 * useSettings — loads current settings and provides a save function.
 *
 * Returns:
 *   settings   — current settings object from the backend (or null while loading)
 *   loading    — true while the initial GET is in flight
 *   saving     — true while a PUT is in flight
 *   error      — backend/network error string for the last failed operation
 *   saveSettings(patch) — PUT the provided patch; updates `settings` on success
 */
export function useSettings(api = settingsApi) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await api.getSettings();
      setSettings(loaded);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const saveSettings = useCallback(async (patch) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateSettings(patch);
      setSettings(updated);
      return updated;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [api]);

  return { settings, loading, saving, error, saveSettings };
}
