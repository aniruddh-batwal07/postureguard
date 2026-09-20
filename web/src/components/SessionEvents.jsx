import React from 'react';
import { formatTime } from '../utils/formatters';

const EVENT_LABELS = {
  slouch_violation: 'Posture violation detected',
  correction_requested: 'Posture correction requested',
  baseline_captured: 'Baseline posture captured',
};

export default function SessionEvents({ events, loading, error }) {
  return (
    <section className="dashboard-card events-card" aria-label="Session events">
      <div className="card-header">
        <div>
          <h2 className="card-title">Session Events</h2>
          <p className="card-subtitle">Recent detection and correction log</p>
        </div>
      </div>

      {loading && events.length === 0 && <p className="loading-message">Loading events…</p>}

      {error && (
        <div className="alert-banner alert-error" role="alert">
          Events error: {error}
        </div>
      )}

      {!loading && !error && events.length === 0 && (
        <p className="empty-message">No events yet.</p>
      )}

      {events.length > 0 && (
        <ul className="events-list">
          {events.map((event) => (
            <li key={event.id} className={`event-item event-type-${event.type}`}>
              <span className="event-title">
                {EVENT_LABELS[event.type] || event.type}
              </span>
              {formatTime(event.timestamp) && (
                <time className="event-time"> at {formatTime(event.timestamp)}</time>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
