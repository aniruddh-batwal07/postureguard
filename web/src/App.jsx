import { useSession } from './hooks/useSession';
import { useSessionEvents } from './hooks/useSessionEvents';

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

export default function App() {
  const { session, loading, busy, error, startSession, endActiveSession } = useSession();
  const activeSessionId = session && session.state !== 'ended' ? session.id : null;
  const { events, loading: eventsLoading, error: eventsError } = useSessionEvents(activeSessionId);

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