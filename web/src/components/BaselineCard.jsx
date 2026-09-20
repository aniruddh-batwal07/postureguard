import React from 'react';

function formatVal(v) {
  return typeof v === 'number' ? v.toFixed(2) : 'N/A';
}

export default function BaselineCard({
  session,
  savedBaseline,
  busy,
  error,
  onCaptureBaseline,
  onResetBaseline,
  onClearSavedBaseline,
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
              PostureGuard is continuously evaluating live posture against your established reference. Click <strong>Capture Posture Baseline</strong> anytime to recalibrate, or <strong>Reset Baseline</strong> if you shift posture or change seating position.
            </p>
          </div>
        )}

        {savedBaseline && (
          <div className="instruction-box info-box" style={{ marginTop: '0.75rem' }}>
            <p className="instruction-title">💾 Stored Local Baseline</p>
            <p className="instruction-text" style={{ fontSize: '0.85rem' }}>
              Stored in browser storage (Head Forward: {formatVal(savedBaseline.head_forward ?? savedBaseline.headForward)}, Head Drop: {formatVal(savedBaseline.head_drop ?? savedBaseline.headDrop)}, Shoulder: {formatVal(savedBaseline.shoulder_roll ?? savedBaseline.shoulderRoll)}). New sessions will start immediately with this reference.
            </p>
            {onClearSavedBaseline && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onClearSavedBaseline}
                style={{ marginTop: '0.5rem', fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
              >
                Clear Saved Baseline
              </button>
            )}
          </div>
        )}

        <div className="baseline-actions">
          <button
            type="button"
            className="btn btn-primary"
            aria-label="Capture Posture Baseline"
            onClick={onCaptureBaseline}
            disabled={!active || busy || baselineState === 'capturing'}
          >
            {baselineState === 'capturing'
              ? 'Capturing Baseline…'
              : baselineState === 'configured'
              ? 'Capture Posture Baseline (Recalibrate)'
              : 'Capture Posture Baseline'}
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
