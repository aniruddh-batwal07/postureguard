import React, { useEffect, useState, useCallback } from 'react';
import Navbar from './components/Navbar';
import OverviewPage from './components/OverviewPage';
import SessionWorkspace from './components/SessionWorkspace';
import SettingsModal from './components/SettingsModal';
import { useSession } from './hooks/useSession';
import { useSessionEvents } from './hooks/useSessionEvents';
import { useSessionHistory } from './hooks/useSessionHistory';
import { useSessionStatistics } from './hooks/useSessionStatistics';
import { useSettings } from './hooks/useSettings';

export default function App({ initialView = 'overview' }) {
  const [currentView, setCurrentView] = useState(initialView);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('baseline');

  const {
    session,
    savedBaseline,
    clearSavedBaseline,
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

  // If a session becomes active, automatically switch to session workspace
  useEffect(() => {
    if (session && session.state !== 'ended') {
      setCurrentView('session');
    }
  }, [session]);

  useEffect(() => {
    if (session) {
      setLastSessionId(session.id);
    }
  }, [session]);

  // Auto-end session when user closes the window or tab
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (session && session.state !== 'ended') {
        const endUrl = `/api/sessions/${session.id}/end`;
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
          navigator.sendBeacon(endUrl, '');
        } else {
          fetch(endUrl, { method: 'POST', keepalive: true }).catch(() => {});
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);
    };
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

  const handleStartSession = useCallback(async (friendlyName) => {
    setCurrentView('session');
    return await startSession(friendlyName);
  }, [startSession]);

  const handleOpenSettings = useCallback((tab = 'baseline') => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  const busy = sessionBusy || baselineBusy;
  const isSessionActive = Boolean(session && session.state !== 'ended');
  const sessionState = session ? session.state : 'idle';

  return (
    <div className="dashboard-root">
      <Navbar
        currentView={currentView}
        onNavigate={setCurrentView}
        onOpenSettings={() => handleOpenSettings('baseline')}
        sessionActive={isSessionActive}
        sessionState={sessionState}
      />

      <main className="dashboard-main-container">
        {currentView === 'overview' && sessionError && (
          <div className="alert-banner alert-error" role="alert" style={{ marginBottom: '1.5rem' }}>
            {sessionError}
          </div>
        )}

        {currentView === 'overview' ? (
          <OverviewPage
            onEnterSession={() => setCurrentView('session')}
            sessionActive={isSessionActive}
            savedBaseline={savedBaseline}
            onOpenSettings={() => handleOpenSettings('baseline')}
          />
        ) : (
          <SessionWorkspace
            session={session}
            savedBaseline={savedBaseline}
            clearSavedBaseline={clearSavedBaseline}
            loading={sessionLoading}
            busy={busy}
            error={sessionError}
            baselineError={baselineError}
            onStartSession={handleStartSession}
            onEndSession={endActiveSession}
            onCaptureBaseline={captureBaseline}
            onResetBaseline={resetBaseline}
            onBackToOverview={() => setCurrentView('overview')}
            onOpenSettings={() => handleOpenSettings('baseline')}
            events={events}
            eventsLoading={eventsLoading}
            eventsError={eventsError}
            statistics={statistics}
            statisticsLoading={statisticsLoading}
            statisticsError={statisticsError}
            statsSessionId={statsSessionId}
          />
        )}
      </main>

      <SettingsModal
        isOpen={settingsOpen}
        onClose={handleCloseSettings}
        session={session}
        savedBaseline={savedBaseline}
        clearSavedBaseline={clearSavedBaseline}
        onCaptureBaseline={captureBaseline}
        baselineBusy={baselineBusy}
        baselineError={baselineError}
        settings={settings}
        settingsLoading={settingsLoading}
        settingsSaving={settingsSaving}
        settingsError={settingsError}
        onSaveSettings={saveSettings}
        history={history}
        historyLoading={historyLoading}
        historyError={historyError}
        onRefreshHistory={refreshHistory}
        initialTab={settingsTab}
      />

      {sessionLoading && (
        <div className="loading-indicator-pill">
          <span className="spinner-indicator"></span>
          <span>Loading session…</span>
        </div>
      )}
    </div>
  );
}