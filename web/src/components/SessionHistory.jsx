import React from 'react';
import { formatDateTime, formatDuration, formatFriendlyName } from '../utils/formatters';

export default function SessionHistory({ history, loading, error, onRefresh }) {
  return (
    <section className="dashboard-card history-card" aria-label="Session history">
      <div className="card-header">
        <div>
          <h2 className="card-title">Session History</h2>
          <p className="card-subtitle">Past posture monitoring sessions</p>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh History'}
        </button>
      </div>

      {loading && history.length === 0 && <p className="loading-message">Loading history…</p>}

      {error && (
        <div className="alert-banner alert-error" role="alert">
          History error: {error}
        </div>
      )}

      {!loading && !error && history.length === 0 && (
        <p className="empty-message">No completed session history available.</p>
      )}

      {history.length > 0 && (
        <div className="table-responsive">
          <table className="history-table">
            <thead>
              <tr>
                <th>Session</th>
                <th>Date & Time</th>
                <th>Duration</th>
                <th>Violations</th>
                <th>Corrections</th>
                <th>Violation Time</th>
                <th>Baseline</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr key={item.id}>
                  <td className="font-medium text-highlight">{formatFriendlyName(item)}</td>
                  <td>{formatDateTime(item.createdAt)}</td>
                  <td>{formatDuration(item.durationSeconds || 0)}</td>
                  <td>
                    <span className="badge badge-subtle-danger">{item.violationCount || 0}</span>
                  </td>
                  <td>
                    <span className="badge badge-subtle-success">{item.correctionCount || 0}</span>
                  </td>
                  <td>{formatDuration(item.violationDurationSeconds || 0)}</td>
                  <td>
                    <span className={`status-badge-sm baseline-badge-${item.baselineState}`}>
                      {item.baselineState || 'unconfigured'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
