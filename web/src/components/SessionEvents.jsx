import React from 'react';
import { formatTime } from '../utils/formatters';

const EVENT_LABELS = {
  slouch_violation: 'Posture violation detected',
  correction_requested: 'Posture correction requested',
  baseline_captured: 'Baseline posture captured',
};

const EVENT_BADGE_CLASSES = {
  slouch_violation: 'event-badge-danger',
  correction_requested: 'event-badge-success',
  baseline_captured: 'event-badge-info',
};

export default function SessionEvents({ events, loading, error }) {
  return (
    <section className="dashboard-card events-card" aria-label="Session events">
      <div className="card-header">
        <div>
          <h2 className="card-title">Session Events</h2>
          <p className="card-subtitle">Real-time posture detection &amp; robotic arm intervention feed</p>
        </div>
        <span className="events-count-badge">
          {events.length} {events.length === 1 ? 'event' : 'events'}
        </span>
      </div>

      {loading && events.length === 0 && <p className="loading-message">Loading events…</p>}

      {error && (
        <div className="alert-banner alert-error" role="alert">
          Events error: {error}
        </div>
      )}

      {!loading && !error && events.length === 0 && (
        <p className="empty-message">No events recorded for this session yet.</p>
      )}

      {events.length > 0 && (
        <ul className="events-list">
          {events.map((event) => {
            const badgeClass = EVENT_BADGE_CLASSES[event.type] || 'event-badge-default';
            return (
              <li key={event.id} className="event-item">
                <div className="event-main">
                  <span className={`event-badge ${badgeClass}`}>
                    <span className="event-badge-dot"></span>
                    {EVENT_LABELS[event.type] || event.type}
                  </span>
                </div>
                {formatTime(event.timestamp) && (
                  <time className="event-time">at {formatTime(event.timestamp)}</time>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
