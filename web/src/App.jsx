import { useEffect, useState } from 'react';
import { useSession } from './hooks/useSession';
import { useSessionEvents } from './hooks/useSessionEvents';
import { useSessionStatistics } from './hooks/useSessionStatistics';

const STATE_LABELS = {
  idle: 'No session active',
  baseline_capturing: 'Capturing posture baseline',
  monitoring: 'Monitoring posture',
  blocked: 'Screen blocked — fix your posture',
  ending: 'Ending session',
  ended: 'Session ended',
};

const EVENT_LABELS = {
  slouch_violation: 'Posture violation detected',
  correction_requested: 'Posture correction requested',
};

function formatEventTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString();
}

function formatDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return '';
  }
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

export default function App() {
  const { session, loading, busy, error, startSession, endActiveSession } = useSession();
  const [lastSessionId, setLastSessionId] = useState(null);

  useEffect(() => {
    if (session) {
      setLastSessionId(session.id);
    }
  }, [session]);

  const activeSessionId = session && session.state !== 'ended' ? session.id : null;
  const statsSessionId = session ? session.id : lastSessionId;
  const { events, loading: eventsLoading, error: eventsError } = useSessionEvents(activeSessionId);
  const {
    statistics,
    loading: statisticsLoading,
    error: statisticsError,
  } = useSessionStatistics(statsSessionId);

  const active = Boolean(session);
  const state = session ? session.state : 'idle';

  return (
    <main>
      <h1>PostureGuard</h1>
      <p>Session dashboard</p>

      <section aria-label="Session status">
        <p>
          Session active: <strong>{active ? 'Yes' : 'No'}</strong>
        </p>
        <p>
          Session state: <strong>{state}</strong>
          <span> — {STATE_LABELS[state] || state}</span>
        </p>
        {session && (
          <p>
            Session id: <code>{session.id}</code>
          </p>
        )}
      </section>

      <section aria-label="Session controls">
        <button type="button" onClick={startSession} disabled={busy || loading || Boolean(session)}>
          Start Session
        </button>
        <button type="button" onClick={endActiveSession} disabled={busy || loading || !session}>
          End Session
        </button>
      </section>

      <section aria-label="Session statistics">
        <h2>Session statistics</h2>
        {statisticsError && (
          <p role="alert">
            Statistics error: {statisticsError}
          </p>
        )}
        {!statsSessionId && !statistics && !statisticsError && (
          <p>Start a session to see statistics.</p>
        )}
        {statsSessionId && statisticsLoading && statistics === null && !statisticsError && (
          <p>Loading statistics…</p>
        )}
        {statistics && (
          <ul>
            <li>
              Session duration: <strong>{formatDuration(statistics.durationSeconds)}</strong>
            </li>
            <li>
              Violations: <strong>{statistics.violationCount}</strong>
            </li>
            <li>
              Corrections: <strong>{statistics.correctionCount}</strong>
            </li>
          </ul>
        )}
      </section>

      <section aria-label="Session events">
        <h2>Session events</h2>
        {eventsLoading && events.length === 0 && <p>Loading events…</p>}
        {eventsError && (
          <p role="alert">
            Events error: {eventsError}
          </p>
        )}
        {!eventsLoading && !eventsError && events.length === 0 && (
          <p>No events yet.</p>
        )}
        {events.length > 0 && (
          <ul>
            {events.map((event) => (
              <li key={event.id}>
                <strong>{EVENT_LABELS[event.type] || event.type}</strong>
                {formatEventTime(event.timestamp) && (
                  <time> at {formatEventTime(event.timestamp)}</time>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {loading && <p>Loading session…</p>}
      {error && (
        <p role="alert">
          Error: {error}
        </p>
      )}
    </main>
  );
}