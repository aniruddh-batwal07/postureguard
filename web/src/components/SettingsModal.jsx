import React, { useEffect, useState } from 'react';
import SessionHistory from './SessionHistory';
import SettingsPanel from './SettingsPanel';

function formatVal(v) {
  return typeof v === 'number' ? v.toFixed(2) : 'N/A';
}

export default function SettingsModal({
  isOpen,
  onClose,
  session,
  savedBaseline,
  clearSavedBaseline,
  onCaptureBaseline,
  baselineBusy,
  baselineError,
  settings,
  settingsLoading,
  settingsSaving,
  settingsError,
  onSaveSettings,
  history,
  historyLoading,
  historyError,
  onRefreshHistory,
  initialTab = 'baseline',
}) {
  const [activeTab, setActiveTab] = useState(initialTab);

  // Sync initialTab when opened
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // Handle Escape key to close modal
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sessionActive = Boolean(session && session.state !== 'ended');
  const baselineState = session?.baselineState || (savedBaseline ? 'configured' : 'unconfigured');

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-container"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <h2 id="settings-modal-title" className="modal-title">Settings &amp; Preferences</h2>
            <p className="modal-subtitle">Configure calibration reference, detection thresholds, and view history</p>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        {/* 2-Option Tabs */}
        <div className="modal-tabs" role="tablist" aria-label="Settings options">
          <button
            type="button"
            role="tab"
            id="tab-baseline"
            aria-selected={activeTab === 'baseline'}
            aria-controls="panel-baseline"
            className={`modal-tab ${activeTab === 'baseline' ? 'modal-tab-active' : ''}`}
            onClick={() => setActiveTab('baseline')}
          >
            1. Posture Baseline &amp; Sensitivity
          </button>
          <button
            type="button"
            role="tab"
            id="tab-history"
            aria-selected={activeTab === 'history'}
            aria-controls="panel-history"
            className={`modal-tab ${activeTab === 'history' ? 'modal-tab-active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            2. Session History
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body">
          {activeTab === 'baseline' && (
            <div id="panel-baseline" role="tabpanel" aria-labelledby="tab-baseline" className="tab-pane">
              {/* Option 1: Baseline Calibration Action */}
              <div className="settings-section">
                <div className="section-header-compact">
                  <h3 className="section-compact-title">Capture New Baseline Angle</h3>
                  <span className={`status-badge-sm baseline-badge-${baselineState}`}>
                    {baselineState === 'configured' && 'Configured'}
                    {baselineState === 'capturing' && 'Capturing…'}
                    {baselineState === 'unconfigured' && 'Not Configured'}
                  </span>
                </div>
                <p className="section-compact-desc">
                  Sit comfortably upright facing your webcam. Capturing a new baseline recalibrates the reference angles for head forward, head drop, and shoulder alignment.
                </p>

                {savedBaseline && (
                  <div className="stored-baseline-summary">
                    <span className="summary-label">Stored Baseline Reference:</span>
                    <span className="summary-values">
                      HF: {formatVal(savedBaseline.head_forward ?? savedBaseline.headForward)} |
                      HD: {formatVal(savedBaseline.head_drop ?? savedBaseline.headDrop)} |
                      SR: {formatVal(savedBaseline.shoulder_roll ?? savedBaseline.shoulderRoll)}
                    </span>
                    {clearSavedBaseline && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={clearSavedBaseline}
                        style={{ marginLeft: 'auto' }}
                      >
                        Clear Saved Baseline
                      </button>
                    )}
                  </div>
                )}

                <div className="settings-action-row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={onCaptureBaseline}
                    disabled={!sessionActive || baselineBusy || session?.baselineState === 'capturing'}
                    aria-label="Capture New Baseline Angle"
                  >
                    {session?.baselineState === 'capturing'
                      ? 'Capturing Baseline…'
                      : 'Capture New Baseline Angle'}
                  </button>
                  {!sessionActive && (
                    <span className="field-note">
                      * Start or resume a session to capture a live webcam baseline angle.
                    </span>
                  )}
                </div>

                {baselineError && (
                  <div className="alert-banner alert-error" role="alert" style={{ marginTop: '0.75rem' }}>
                    Baseline error: {baselineError}
                  </div>
                )}
              </div>

              {/* Sensitivity & Debounce Tuning */}
              <div className="settings-section" style={{ marginTop: '1.5rem' }}>
                <SettingsPanel
                  settings={settings}
                  loading={settingsLoading}
                  saving={settingsSaving}
                  error={settingsError}
                  onSaveSettings={onSaveSettings}
                />
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div id="panel-history" role="tabpanel" aria-labelledby="tab-history" className="tab-pane">
              <SessionHistory
                history={history}
                loading={historyLoading}
                error={historyError}
                onRefresh={onRefreshHistory}
              />
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
          >
            Close Settings
          </button>
        </div>
      </div>
    </div>
  );
}
