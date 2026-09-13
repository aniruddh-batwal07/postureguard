import { useSession } from './hooks/useSession';

export default function App() {
  const { session, loading, busy, error, startSession, endActiveSession } = useSession();

  const active = Boolean(session);

  return (
    <main>
      <h1>PostureGuard</h1>
      <p>Session dashboard</p>

      <section aria-label="Session status">
        <p>
          Session active: <strong>{active ? 'Yes' : 'No'}</strong>
        </p>
        <p>
          Session state: <strong>{session ? session.state : 'idle'}</strong>
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

      {loading && <p>Loading session…</p>}
      {error && (
        <p role="alert">
          Error: {error}
        </p>
      )}
    </main>
  );
}