import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import * as api from '../src/api/sessions';
import * as eventsApi from '../src/api/events';
import * as statisticsApi from '../src/api/statistics';
import * as settingsApi from '../src/api/settings';

vi.mock('../src/api/sessions', () => ({
  getActiveSession: vi.fn(),
  createSession: vi.fn(),
  endSession: vi.fn(),
  captureBaseline: vi.fn(),
  resetBaseline: vi.fn(),
  getSessionHistory: vi.fn(),
}));

vi.mock('../src/api/events', () => ({
  getEvents: vi.fn(),
}));

vi.mock('../src/api/statistics', () => ({
  getStatistics: vi.fn(),
}));

vi.mock('../src/api/settings', () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

const SESSION_ID = 'a2f4c3b1-1111-4222-8333-444455556666';

function session(overrides = {}) {
  return {
    id: SESSION_ID,
    friendlyName: 'Session Sep 20, 16:30',
    state: 'monitoring',
    baselineState: 'configured',
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    endedAt: null,
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    id: 'e2e1f0d0-0000-4000-8000-000000000001',
    sessionId: SESSION_ID,
    type: 'slouch_violation',
    timestamp: '2026-09-20T10:05:00.000Z',
    ...overrides,
  };
}

function statistics(overrides = {}) {
  return {
    sessionId: SESSION_ID,
    durationSeconds: 600,
    violationCount: 0,
    correctionCount: 0,
    violationDurationSeconds: 0,
    startedAt: '2026-09-20T10:00:00.000Z',
    endedAt: null,
    ...overrides,
  };
}

function defaultSettings(overrides = {}) {
  return {
    slouchThreshold: 0.15,
    slouchDurationSeconds: 2.0,
    correctionDurationSeconds: 2.0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  eventsApi.getEvents.mockResolvedValue([]);
  statisticsApi.getStatistics.mockResolvedValue(statistics());
  settingsApi.getSettings.mockResolvedValue(defaultSettings());
  settingsApi.updateSettings.mockResolvedValue(defaultSettings());
  api.getSessionHistory.mockResolvedValue([]);
  vi.stubEnv('VITE_SESSION_POLL_INTERVAL_MS', '60000');
  vi.stubEnv('VITE_HISTORY_POLL_INTERVAL_MS', '60000');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Intro Section', () => {
  it('renders the PostureGuard intro hero section', async () => {
    api.getActiveSession.mockResolvedValue(null);
    render(<App />);

    expect(screen.getByRole('region', { name: 'PostureGuard introduction' })).toBeInTheDocument();
    expect(screen.getByText('PostureGuard Dashboard')).toBeInTheDocument();
    expect(screen.getByText(/combines continuous webcam-based computer vision/i)).toBeInTheDocument();
  });
});

describe('App session dashboard', () => {
  it('renders the idle state when no session is active', async () => {
    api.getActiveSession.mockResolvedValue(null);
    render(<App />);

    const start = screen.getByRole('button', { name: 'Start Session' });
    await waitFor(() => expect(start).toBeEnabled());

    expect(screen.getByRole('button', { name: 'End Session' })).toBeDisabled();
    expect(screen.getByText('No')).toBeInTheDocument();
    expect(screen.getByText('idle')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.getActiveSession).toHaveBeenCalledTimes(1);
  });

  it('renders an active session with friendly info and hides raw UUID', async () => {
    const activeSess = session({ state: 'monitoring', friendlyName: 'My Morning Session' });
    api.getActiveSession.mockResolvedValue(activeSess);
    render(<App />);

    const end = screen.getByRole('button', { name: 'End Session' });
    await waitFor(() => expect(end).toBeEnabled());

    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('monitoring')).toBeInTheDocument();
    expect(screen.getByText('My Morning Session')).toBeInTheDocument();
    // Raw UUID must NOT be displayed in normal UI
    expect(screen.queryByText(SESSION_ID)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Session' })).toBeDisabled();
  });

  it('starts a session without capturing baseline automatically', async () => {
    const created = session({ state: 'active', baselineState: 'unconfigured' });
    api.getActiveSession.mockResolvedValueOnce(null).mockResolvedValueOnce(created);
    api.createSession.mockResolvedValue(created);
    render(<App />);

    const start = screen.getByRole('button', { name: 'Start Session' });
    await waitFor(() => expect(start).toBeEnabled());

    await userEvent.click(start);

    await waitFor(() => expect(api.createSession).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Yes')).toBeInTheDocument());

    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('⚠️ Baseline Unconfigured')).toBeInTheDocument();
    expect(start).toBeDisabled();
  });

  it('ends the active session and refreshes history', async () => {
    const active = session({ state: 'monitoring' });
    api.getActiveSession.mockResolvedValueOnce(active).mockResolvedValueOnce(null);
    api.endSession.mockResolvedValue(session({ state: 'ended', endedAt: '2026-09-20T11:00:00.000Z' }));
    render(<App />);

    const end = screen.getByRole('button', { name: 'End Session' });
    await waitFor(() => expect(end).toBeEnabled());

    await userEvent.click(end);

    await waitFor(() => expect(api.endSession).toHaveBeenCalledWith(SESSION_ID));
    await waitFor(() => expect(screen.getByText('No')).toBeInTheDocument());

    expect(screen.getByText('idle')).toBeInTheDocument();
    expect(end).toBeDisabled();
  });

  it('shows an error when initial session load fails', async () => {
    api.getActiveSession.mockRejectedValue(new Error('MongoDB is not connected'));
    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('MongoDB is not connected'),
    );

    expect(screen.getByText('No')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Session' })).toBeEnabled();
  });
});

describe('Baseline Management', () => {
  it('renders unconfigured baseline status with instructions', async () => {
    api.getActiveSession.mockResolvedValue(session({ baselineState: 'unconfigured' }));
    render(<App />);

    await waitFor(() => expect(screen.getByText('⚠️ Baseline Unconfigured')).toBeInTheDocument());
    expect(screen.getByText('Posture Violation Detection Inactive')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Capture Posture Baseline' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reset Baseline' })).toBeDisabled();
  });

  it('triggers baseline capture when user clicks Capture Posture Baseline', async () => {
    const active = session({ baselineState: 'unconfigured' });
    const capturing = session({ baselineState: 'capturing' });
    api.getActiveSession.mockResolvedValueOnce(active).mockResolvedValueOnce(capturing);
    api.captureBaseline.mockResolvedValue(capturing);

    render(<App />);

    const captureBtn = await screen.findByRole('button', { name: 'Capture Posture Baseline' });
    await userEvent.click(captureBtn);

    await waitFor(() => expect(api.captureBaseline).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('⏳ Capturing Baseline…')).toBeInTheDocument());
  });

  it('triggers baseline reset when user clicks Reset Baseline', async () => {
    const configuredSess = session({ baselineState: 'configured' });
    const resetSess = session({ baselineState: 'unconfigured' });
    api.getActiveSession.mockResolvedValueOnce(configuredSess).mockResolvedValueOnce(resetSess);
    api.resetBaseline.mockResolvedValue(resetSess);

    render(<App />);

    const resetBtn = await screen.findByRole('button', { name: 'Reset Baseline' });
    await waitFor(() => expect(resetBtn).toBeEnabled());

    await userEvent.click(resetBtn);

    await waitFor(() => expect(api.resetBaseline).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('⚠️ Baseline Unconfigured')).toBeInTheDocument());
  });

  it('shows error banner when capture baseline fails', async () => {
    api.getActiveSession.mockResolvedValue(session({ baselineState: 'unconfigured' }));
    api.captureBaseline.mockRejectedValue(new Error('webcam busy'));

    render(<App />);

    const captureBtn = await screen.findByRole('button', { name: 'Capture Posture Baseline' });
    await userEvent.click(captureBtn);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Baseline error: webcam busy'),
    );
  });

  it('uses stored baseline from localStorage when starting a session', async () => {
    const saved = { head_forward: 0.22, head_drop: 0.15, shoulder_roll: 0.05, sample_count: 30 };
    localStorage.setItem('postureguard_saved_baseline', JSON.stringify(saved));

    const created = session({ state: 'active', baselineState: 'configured', baseline: saved });
    api.getActiveSession.mockResolvedValueOnce(null).mockResolvedValueOnce(created);
    api.createSession.mockResolvedValue(created);

    render(<App />);

    const start = screen.getByRole('button', { name: 'Start Session' });
    await waitFor(() => expect(start).toBeEnabled());
    await userEvent.click(start);

    await waitFor(() => {
      expect(api.createSession).toHaveBeenCalledWith({
        friendlyName: undefined,
        baseline: expect.objectContaining({ head_forward: 0.22 }),
      });
    });

    localStorage.removeItem('postureguard_saved_baseline');
  });

  it('persists configured baseline to localStorage and renders stored baseline box', async () => {
    const saved = { head_forward: 0.18, head_drop: 0.12, shoulder_roll: 0.04, sample_count: 30 };
    const configuredSess = session({ baselineState: 'configured', baseline: saved });
    api.getActiveSession.mockResolvedValue(configuredSess);

    render(<App />);

    await waitFor(() => expect(screen.getByText(/Stored Local Baseline/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Clear Saved Baseline/i })).toBeInTheDocument();
    expect(localStorage.getItem('postureguard_saved_baseline')).toContain('0.18');

    // Clicking clear removes it from localStorage
    await userEvent.click(screen.getByRole('button', { name: /Clear Saved Baseline/i }));
    expect(localStorage.getItem('postureguard_saved_baseline')).toBeNull();
  });
});

describe('App session states & blocking', () => {
  it('renders each backend session state with a clear label', async () => {
    const cases = {
      idle: 'No session active',
      baseline_capturing: 'Capturing posture baseline',
      monitoring: 'Monitoring posture',
      blocking: 'Blocking screen — moving card into view',
      blocked: 'Screen blocked — fix your posture',
      unblocking: 'Restoring screen — removing card',
      ending: 'Ending session',
      ended: 'Session ended',
    };

    for (const [state, label] of Object.entries(cases)) {
      api.getActiveSession.mockResolvedValue(
        state === 'idle' ? null : session({ state }),
      );
      const { unmount } = render(<App />);

      await waitFor(() => expect(screen.getByText(state)).toBeInTheDocument());
      expect(screen.getByText(new RegExp(label))).toBeInTheDocument();

      unmount();
    }
  });

  it('shows a Fix your posture message while blocked', async () => {
    api.getActiveSession.mockResolvedValue(session({ state: 'blocked' }));
    render(<App />);

    await waitFor(() => expect(screen.getByText('Fix your posture.')).toBeInTheDocument());
  });
});

describe('Live Events & Metrics', () => {
  it('shows slouch_violation and correction_requested events', async () => {
    api.getActiveSession.mockResolvedValue(session({ state: 'monitoring' }));
    eventsApi.getEvents.mockResolvedValue([
      event({ type: 'slouch_violation' }),
      event({ id: 'ev-2', type: 'correction_requested' }),
    ]);
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText('Posture violation detected')).toBeInTheDocument(),
    );
    expect(screen.getByText('Posture correction requested')).toBeInTheDocument();
  });

  it('renders duration, violations, corrections, violation time, and screen status', async () => {
    api.getActiveSession.mockResolvedValue(session({ state: 'monitoring' }));
    statisticsApi.getStatistics.mockResolvedValue(
      statistics({ durationSeconds: 7200, violationCount: 3, correctionCount: 2, violationDurationSeconds: 120 }),
    );
    render(<App />);

    const section = screen.getByRole('region', { name: 'Session statistics' });
    await waitFor(() => expect(section).toHaveTextContent('2h'));
    expect(section).toHaveTextContent('Violations');
    expect(section).toHaveTextContent('3');
    expect(section).toHaveTextContent('Corrections');
    expect(section).toHaveTextContent('2');
    expect(section).toHaveTextContent('2m 0s');
    expect(section).toHaveTextContent('Clear (Docked)');
  });
});

describe('Session History', () => {
  it('renders history table with completed sessions without raw UUIDs', async () => {
    api.getActiveSession.mockResolvedValue(null);
    api.getSessionHistory.mockResolvedValue([
      {
        id: 'hist-1234-5678',
        friendlyName: 'Morning Session',
        createdAt: '2026-09-20T08:00:00.000Z',
        endedAt: '2026-09-20T09:00:00.000Z',
        durationSeconds: 3600,
        violationCount: 2,
        correctionCount: 2,
        violationDurationSeconds: 90,
        baselineState: 'configured',
      },
    ]);

    render(<App />);

    const historySection = screen.getByRole('region', { name: 'Session history' });
    await waitFor(() => expect(within(historySection).getByText('Morning Session')).toBeInTheDocument());
    expect(within(historySection).getByText('1h')).toBeInTheDocument();
    expect(within(historySection).getAllByText('2').length).toBeGreaterThanOrEqual(1);
    expect(within(historySection).queryByText('hist-1234-5678')).not.toBeInTheDocument();
  });


  it('renders empty history message when no history exists', async () => {
    api.getActiveSession.mockResolvedValue(null);
    api.getSessionHistory.mockResolvedValue([]);
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText('No completed session history available.')).toBeInTheDocument(),
    );
  });
});

describe('App settings', () => {
  beforeEach(() => {
    api.getActiveSession.mockResolvedValue(null);
  });

  it('renders the settings section with loaded values', async () => {
    settingsApi.getSettings.mockResolvedValue(defaultSettings({
      slouchThreshold: 0.15,
      slouchDurationSeconds: 2.0,
      correctionDurationSeconds: 2.0,
    }));
    render(<App />);

    const section = await screen.findByRole('region', { name: 'Detection settings' });
    await waitFor(() => expect(within(section).getByLabelText(/Slouch threshold/i)).toBeInTheDocument());

    expect(within(section).getByLabelText(/Slouch threshold/i)).toHaveValue(0.15);
    expect(within(section).getByLabelText(/Slouch duration/i)).toHaveValue(2.0);
    expect(within(section).getByLabelText(/Correction duration/i)).toHaveValue(2.0);
  });

  it('saves settings and shows a success message', async () => {
    settingsApi.getSettings.mockResolvedValue(defaultSettings());
    settingsApi.updateSettings.mockResolvedValue(defaultSettings({ slouchThreshold: 0.25 }));
    render(<App />);

    const saveBtn = await screen.findByRole('button', { name: /Save settings/i });
    await waitFor(() => expect(saveBtn).not.toBeDisabled());

    await userEvent.click(saveBtn);

    await waitFor(() => expect(settingsApi.updateSettings).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Settings saved.'));
  });
});