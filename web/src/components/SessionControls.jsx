import React from 'react';
import { formatDateTime, formatFriendlyName } from '../utils/formatters';

const STATE_LABELS = {
  idle: 'No session active',
  baseline_capturing: 'Capturing posture baseline',
  monitoring: 'Monitoring posture',
  blocking: 'Blocking screen — moving card into view',
  blocked: 'Screen blocked — fix your posture',
  unblocking: 'Restoring screen — removing card',
  ending: 'Ending session',
  ended: 'Session ended',
};

export default function SessionControls({
  session,
  loading,
  busy,
  error,
  onStartSession,
  onEndSession,
}) {
  const active = Boolean(session && session.state !== 'ended');
  const state = session ? session.state : 'idle';
  const friendlyName = session ? formatFriendlyName(session) : null;
  const startTime = session ? formatDateTime(session.createdAt) : null;

  return (
    <section className="dashboard-card session-controls-card" aria-label="Session status">
      <div className="card-header">
        <div>
          <h2 className="card-title">Session Controls</h2>
          <p className="card-subtitle">Manage your active monitoring session</p>
        </div>
        <div className="status-indicators">
          <span className={`status-badge ${active ? 'badge-active' : 'badge-idle'}`}>
            <span className="badge-dot"></span>
            Session active: <strong>{active ? 'Yes' : 'No'}</strong>
          </span>
          <span className={`status-badge badge-state-${state}`}>
            Session state: <strong>{state}</strong>
            <span className="state-description"> — {STATE_LABELS[state] || state}</span>
          </span>
        </div>
      </div>

      {session && (
        <div className="session-info-bar">
          <div className="info-item">
            <span className="info-label">Active Session:</span>
            <span className="info-value text-highlight">{friendlyName}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Started At:</span>
            <span className="info-value">{startTime}</span>
          </div>
        </div>
      )}

      {session && session.state === 'blocked' && (
        <div className="alert-banner alert-danger" role="alert">
          <span className="alert-icon">⚠️</span>
          <strong>Fix your posture.</strong>
        </div>
      )}

      <div className="controls-button-group" aria-label="Session controls">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onStartSession()}
          disabled={busy || loading || active}
        >
          {busy && !active ? 'Starting…' : 'Start Session'}
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={onEndSession}
          disabled={busy || loading || !active}
        >
          {busy && active ? 'Ending…' : 'End Session'}
        </button>
      </div>

      {error && (
        <div className="alert-banner alert-error" role="alert">
          Error: {error}
        </div>
      )}
    </section>
  );
}
