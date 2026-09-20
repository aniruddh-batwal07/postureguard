import React from 'react';

export default function Navbar({
  currentView,
  onNavigate,
  onOpenSettings,
  sessionActive,
  sessionState,
}) {
  return (
    <header className="site-navbar">
      <div className="navbar-container">
        <div className="navbar-brand-group">
          <div className="brand-badge-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </div>
          <div>
            <span className="brand-name">PostureGuard</span>
            <span className="brand-tagline">Physical Ergonomic Intervention</span>
          </div>
        </div>

        <div className="navbar-telemetry" aria-label="System telemetry">
          <span className="telemetry-pill">
            <span className={`telemetry-dot ${sessionActive ? 'dot-active' : 'dot-idle'}`}></span>
            Arduino COM13: <strong>{sessionActive ? 'Active' : 'Docked'}</strong>
          </span>
          <span className="telemetry-pill">
            <span className="telemetry-dot dot-ready"></span>
            Webcam: <strong>Ready</strong>
          </span>
        </div>

        <div className="navbar-actions">
          <nav className="view-switcher" aria-label="Main Navigation">
            <button
              type="button"
              className={`nav-tab ${currentView === 'overview' ? 'nav-tab-active' : ''}`}
              onClick={() => onNavigate('overview')}
              aria-current={currentView === 'overview' ? 'page' : undefined}
            >
              Overview
            </button>
            <button
              type="button"
              className={`nav-tab ${currentView === 'session' ? 'nav-tab-active' : ''}`}
              onClick={() => onNavigate('session')}
              aria-current={currentView === 'session' ? 'page' : undefined}
            >
              Session Workspace
              {sessionActive && <span className="active-session-ping" title="Active session running"></span>}
            </button>
          </nav>

          <button
            type="button"
            className="btn btn-secondary btn-settings"
            onClick={onOpenSettings}
            aria-label="Settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            <span>Settings</span>
          </button>
        </div>
      </div>
    </header>
  );
}
