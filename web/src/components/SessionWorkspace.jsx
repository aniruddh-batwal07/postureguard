import React from 'react';
import BaselineCard from './BaselineCard';
import LiveMetrics from './LiveMetrics';
import SessionControls from './SessionControls';
import SessionEvents from './SessionEvents';

export default function SessionWorkspace({
  session,
  savedBaseline,
  clearSavedBaseline,
  loading,
  busy,
  error,
  baselineError,
  onStartSession,
  onEndSession,
  onCaptureBaseline,
  onResetBaseline,
  onBackToOverview,
  onOpenSettings,
  events,
  eventsLoading,
  eventsError,
  statistics,
  statisticsLoading,
  statisticsError,
  statsSessionId,
}) {
  return (
    <div className="session-workspace">
      {/* Top Workspace Bar */}
      <div className="workspace-top-bar">
        <button
          type="button"
          className="back-link-btn"
          onClick={onBackToOverview}
          aria-label="Back to Overview"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          Back to Overview
        </button>

        <div className="workspace-title-group">
          <h1 className="workspace-heading">Session Workspace</h1>
          <span className="workspace-subheading">Active monitoring, baseline calibration, and live physical actuator control</span>
        </div>

        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onOpenSettings}
        >
          ⚙ Settings &amp; History
        </button>
      </div>

      {/* Main Controls Section: Two Main Options (Start Session & End Session) + Status Banner */}
      <div className="workspace-controls-section">
        <SessionControls
          session={session}
          loading={loading}
          busy={busy}
          error={error}
          onStartSession={onStartSession}
          onEndSession={onEndSession}
        />
      </div>

      {/* Workspace Grid: Baseline Calibration, Live Statistics, and Events */}
      <div className="workspace-grid">
        {/* Baseline Card (available directly on session page as requested) */}
        <div className="grid-cell">
          <BaselineCard
            session={session}
            savedBaseline={savedBaseline}
            busy={busy}
            error={baselineError}
            onCaptureBaseline={onCaptureBaseline}
            onResetBaseline={onResetBaseline}
            onClearSavedBaseline={clearSavedBaseline}
          />
        </div>

        {/* Live Metrics & Analytics */}
        <div className="grid-cell">
          <LiveMetrics
            session={session}
            statsSessionId={statsSessionId}
            statistics={statistics}
            loading={statisticsLoading}
            error={statisticsError}
          />
        </div>

        {/* Live Events Stream */}
        <div className="grid-cell full-width-cell">
          <SessionEvents
            events={events}
            loading={eventsLoading}
            error={eventsError}
          />
        </div>
      </div>
    </div>
  );
}
