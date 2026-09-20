import { useEffect, useState } from 'react';
import BaselineCard from './components/BaselineCard';
import IntroHero from './components/IntroHero';
import LiveMetrics from './components/LiveMetrics';
import SessionControls from './components/SessionControls';
import SessionEvents from './components/SessionEvents';
import SessionHistory from './components/SessionHistory';
import SettingsPanel from './components/SettingsPanel';
import { useSession } from './hooks/useSession';
import { useSessionEvents } from './hooks/useSessionEvents';
import { useSessionHistory } from './hooks/useSessionHistory';
import { useSessionStatistics } from './hooks/useSessionStatistics';
import { useSettings } from './hooks/useSettings';

export default function App() {
  const {
    session,
    loading: sessionLoading,
    busy: sessionBusy,
    baselineBusy,
    error: sessionError,
    baselineError,
    startSession,
    endActiveSession,
    captureBaseline,
    resetBaseline,
  } = useSession();

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

  const {
    history,
    loading: historyLoading,
    error: historyError,
    refresh: refreshHistory,
  } = useSessionHistory();

  const {
    settings,
    loading: settingsLoading,
    saving: settingsSaving,
    error: settingsError,
    saveSettings,
  } = useSettings();

  // Refresh history when active session transitions to ended
  useEffect(() => {
    if (session && session.state === 'ended') {
      refreshHistory();
    }
  }, [session, refreshHistory]);

  const busy = sessionBusy || baselineBusy;

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div>
          <h1 className="brand-title">PostureGuard</h1>
          <p className="brand-subtitle">Real-time posture monitoring & robotic screen intervention</p>
        </div>
      </header>

      <IntroHero />

      <main className="dashboard-grid">
        <div className="full-width-column">
          <SessionControls
            session={session}
            loading={sessionLoading}
            busy={busy}
            error={sessionError}
            onStartSession={startSession}
            onEndSession={endActiveSession}
          />
        </div>

        <BaselineCard
          session={session}
          busy={busy}
          error={baselineError}
          onCaptureBaseline={captureBaseline}
          onResetBaseline={resetBaseline}
        />

        <LiveMetrics
          session={session}
          statsSessionId={statsSessionId}
          statistics={statistics}
          loading={statisticsLoading}
          error={statisticsError}
        />

        <SessionEvents
          events={events}
          loading={eventsLoading}
          error={eventsError}
        />

        <SettingsPanel
          settings={settings}
          loading={settingsLoading}
          saving={settingsSaving}
          error={settingsError}
          onSaveSettings={saveSettings}
        />

        <div className="full-width-column">
          <SessionHistory
            history={history}
            loading={historyLoading}
            error={historyError}
            onRefresh={refreshHistory}
          />
        </div>
      </main>

      {sessionLoading && <p className="loading-message">Loading session…</p>}
    </div>
  );
}