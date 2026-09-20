import React, { useEffect, useState } from 'react';

export default function SettingsPanel({
  settings,
  loading,
  saving,
  error,
  onSaveSettings,
}) {
  const [draft, setDraft] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (settings) {
      setDraft({
        slouchThreshold: String(settings.slouchThreshold),
        slouchDurationSeconds: String(settings.slouchDurationSeconds),
        correctionDurationSeconds: String(settings.correctionDurationSeconds),
      });
    }
  }, [settings]);

  function handleDraftChange(field, value) {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setSaveSuccess(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!draft) return;
    const patch = {};
    const threshold = parseFloat(draft.slouchThreshold);
    const slouchDur = parseFloat(draft.slouchDurationSeconds);
    const corrDur = parseFloat(draft.correctionDurationSeconds);
    if (Number.isFinite(threshold)) patch.slouchThreshold = threshold;
    if (Number.isFinite(slouchDur)) patch.slouchDurationSeconds = slouchDur;
    if (Number.isFinite(corrDur)) patch.correctionDurationSeconds = corrDur;

    try {
      await onSaveSettings(patch);
      setSaveSuccess(true);
    } catch {
      setSaveSuccess(false);
    }
  }

  return (
    <section className="dashboard-card settings-card" aria-label="Detection settings">
      <div className="card-header">
        <div>
          <h2 className="card-title">Detection Settings</h2>
          <p className="card-subtitle">Tune live posture rule sensitivity and debounce durations</p>
        </div>
      </div>

      {loading && settings === null && <p className="loading-message">Loading settings…</p>}

      {error && (
        <div className="alert-banner alert-error" role="alert">
          Settings error: {error}
        </div>
      )}

      {settings && draft && (
        <form onSubmit={handleSubmit} aria-label="Settings form" className="settings-form">
          <fieldset className="settings-fieldset">
            <legend className="fieldset-legend">Slouch detection parameters</legend>

            <div className="form-group">
              <label htmlFor="settings-slouch-threshold" className="form-label">
                Slouch threshold (0–1)
              </label>
              <input
                id="settings-slouch-threshold"
                className="form-input"
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={draft.slouchThreshold}
                onChange={(e) => handleDraftChange('slouchThreshold', e.target.value)}
              />
              <span className="field-help">Lower values increase sensitivity to slouching.</span>
            </div>

            <div className="form-group">
              <label htmlFor="settings-slouch-duration" className="form-label">
                Slouch duration (seconds)
              </label>
              <input
                id="settings-slouch-duration"
                className="form-input"
                type="number"
                step="0.1"
                min="0.1"
                max="60"
                value={draft.slouchDurationSeconds}
                onChange={(e) => handleDraftChange('slouchDurationSeconds', e.target.value)}
              />
              <span className="field-help">Duration slouch must persist before triggering card deployment.</span>
            </div>

            <div className="form-group">
              <label htmlFor="settings-correction-duration" className="form-label">
                Correction duration (seconds)
              </label>
              <input
                id="settings-correction-duration"
                className="form-input"
                type="number"
                step="0.1"
                min="0.1"
                max="60"
                value={draft.correctionDurationSeconds}
                onChange={(e) => handleDraftChange('correctionDurationSeconds', e.target.value)}
              />
              <span className="field-help">Duration upright posture must hold before retracting card.</span>
            </div>
          </fieldset>

          <div className="form-actions">
            <button
              type="submit"
              id="settings-save-btn"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save settings'}
            </button>
            {saveSuccess && !error && (
              <span className="save-status-text" role="status">
                Settings saved.
              </span>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
