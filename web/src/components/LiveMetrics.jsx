import React from 'react';
import { formatDuration } from '../utils/formatters';

export default function LiveMetrics({
  session,
  statsSessionId,
  statistics,
  loading,
  error,
}) {
  const isBlocking = session?.state === 'blocking' || session?.state === 'blocked';
  const screenStatus = isBlocking ? 'Blocked (Card Deployed)' : 'Clear (Docked)';

  return (
    <section className="dashboard-card metrics-card" aria-label="Session statistics">
      <div className="card-header">
        <div>
          <h2 className="card-title">Session Statistics</h2>
          <p className="card-subtitle">Real-time posture analytics and arm status</p>
        </div>
      </div>

      {error && (
        <div className="alert-banner alert-error" role="alert">
          Statistics error: {error}
        </div>
      )}

      {!statsSessionId && !statistics && !error && (
        <p className="empty-message">Start a session to see statistics.</p>
      )}

      {statsSessionId && loading && statistics === null && !error && (
        <p className="loading-message">Loading statistics…</p>
      )}

      {statistics && (
        <div className="metrics-grid">
          <div className="metric-box">
            <span className="metric-label">Session Duration</span>
            <span className="metric-value">{formatDuration(statistics.durationSeconds)}</span>
          </div>

          <div className="metric-box">
            <span className="metric-label">Violations</span>
            <span className="metric-value text-danger">{statistics.violationCount}</span>
          </div>

          <div className="metric-box">
            <span className="metric-label">Corrections</span>
            <span className="metric-value text-success">{statistics.correctionCount}</span>
          </div>

          <div className="metric-box">
            <span className="metric-label">Total Violation Time</span>
            <span className="metric-value text-warning">
              {formatDuration(statistics.violationDurationSeconds || 0)}
            </span>
          </div>

          <div className="metric-box full-width-metric">
            <span className="metric-label">Arm / Screen Status</span>
            <span className={`metric-value status-indicator ${isBlocking ? 'text-danger' : 'text-success'}`}>
              {screenStatus}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
