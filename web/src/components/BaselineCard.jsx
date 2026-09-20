import React from 'react';

export default function BaselineCard({
  session,
  busy,
  error,
  onCaptureBaseline,
  onResetBaseline,
}) {
  const active = Boolean(session && session.state !== 'ended');
  const baselineState = session?.baselineState || 'unconfigured';

  return (
    <section className="dashboard-card baseline-card" aria-label="Posture Baseline">
      <div className="card-header">
        <div>
          <h2 className="card-title">Posture Baseline</h2>
          <p className="card-subtitle">Calibrate upright posture reference before evaluation</p>
        </div>
        <span className={`status-badge baseline-badge-${baselineState}`}>
          {baselineState === 'configured' && '✓ Baseline Configured'}
          {baselineState === 'capturing' && '⏳ Capturing Baseline…'}
          {baselineState === 'unconfigured' && '⚠️ Baseline Unconfigured'}
        </span>
      </div>

      <div className="baseline-body">
        {baselineState === 'unconfigured' && (
          <div className="instruction-box warning-box">
            <p className="instruction-title">Posture Violation Detection Inactive</p>
            <p className="instruction-text">
              Please sit comfortably upright facing the camera with your head and shoulders in clear view, then click <strong>Capture Posture Baseline</strong> below to enable posture violation monitoring.
            </p>
          </div>
        )}

        {baselineState === 'capturing' && (
          <div className="instruction-box info-box">
            <div className="spinner-indicator"></div>
            <p className="instruction-title">Capturing Posture Baseline</p>
            <p className="instruction-text">
              Hold a steady, upright posture. The background daemon is capturing your pose reference samples…
            </p>
          </div>
        )}

        {baselineState === 'configured' && (
          <div className="instruction-box success-box">
            <p className="instruction-title">Upright Baseline Established</p>
            <p className="instruction-text">
              PostureGuard is continuously evaluating live posture against your established reference. Click <strong>Reset Baseline</strong> if you shift posture or change seating position.
            </p>
          </div>
        )}

        <div className="baseline-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onCaptureBaseline}
            disabled={!active || busy || baselineState === 'capturing'}
          >
            {baselineState === 'capturing' ? 'Capturing Baseline…' : 'Capture Posture Baseline'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onResetBaseline}
            disabled={!active || busy || baselineState === 'unconfigured'}
          >
            Reset Baseline
          </button>
        </div>

        {error && (
          <div className="alert-banner alert-error" role="alert">
            Baseline error: {error}
          </div>
        )}
      </div>
    </section>
  );
}
