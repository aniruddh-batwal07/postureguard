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
    state: 'baseline_capturing',
    createdAt: '2026-09-13T10:00:00.000Z',
    updatedAt: '2026-09-13T10:00:00.000Z',
    endedAt: null,
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    id: 'e2e1f0d0-0000-4000-8000-000000000001',
    sessionId: SESSION_ID,
    type: 'slouch_violation',
    timestamp: '2026-09-13T10:05:00.000Z',
    ...overrides,
  };
}

function statistics(overrides = {}) {
  return {
    sessionId: SESSION_ID,
    durationSeconds: 600,
    violationCount: 0,
    correctionCount: 0,
    startedAt: '2026-09-13T10:00:00.000Z',
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
  // Keep the session-state poll from firing during count-sensitive tests.
  vi.stubEnv('VITE_SESSION_POLL_INTERVAL_MS', '60000');
});

afterEach(() => {
  vi.unstubAllEnvs();
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

  it('renders an active session with its state', async () => {
    api.getActiveSession.mockResolvedValue(session({ state: 'monitoring' }));
    render(<App />);

    const end = screen.getByRole('button', { name: 'End Session' });
    await waitFor(() => expect(end).toBeEnabled());

    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('monitoring')).toBeInTheDocument();
    expect(screen.getByText(SESSION_ID)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Session' })).toBeDisabled();
  });

  it('starts a session and refreshes the displayed state', async () => {
    const created = session();
    api.getActiveSession.mockResolvedValueOnce(null).mockResolvedValueOnce(created);
    api.createSession.mockResolvedValue(created);
    render(<App />);

    const start = screen.getByRole('button', { name: 'Start Session' });
    await waitFor(() => expect(start).toBeEnabled());

    await userEvent.click(start);

    await waitFor(() => expect(api.createSession).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Yes')).toBeInTheDocument());

    expect(screen.getByText('baseline_capturing')).toBeInTheDocument();
    expect(start).toBeDisabled();
    expect(api.getActiveSession).toHaveBeenCalledTimes(2);
  });

  it('ends the active session and refreshes the displayed state', async () => {
    const active = session({ state: 'monitoring' });
    api.getActiveSession.mockResolvedValueOnce(active).mockResolvedValueOnce(null);
    api.endSession.mockResolvedValue(session({ state: 'ended', endedAt: '2026-09-13T11:00:00.000Z' }));
    render(<App />);

    const end = screen.getByRole('button', { name: 'End Session' });
    await waitFor(() => expect(end).toBeEnabled());

    await userEvent.click(end);

    await waitFor(() => expect(api.endSession).toHaveBeenCalledWith(SESSION_ID));
    await waitFor(() => expect(screen.getByText('No')).toBeInTheDocument());

    expect(screen.getByText('idle')).toBeInTheDocument();
    expect(end).toBeDisabled();
  });

  it('shows an error when the initial session load fails', async () => {
    api.getActiveSession.mockRejectedValue(new Error('MongoDB is not connected'));
    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('MongoDB is not connected'),
    );

    expect(screen.getByText('No')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Session' })).toBeEnabled();
  });

  it('shows an error when starting a session fails', async () => {
    api.getActiveSession.mockResolvedValue(null);
    api.createSession.mockRejectedValue(new Error('an active session already exists'));
    render(<App />);

    const start = screen.getByRole('button', { name: 'Start Session' });
    await waitFor(() => expect(start).toBeEnabled());

    await userEvent.click(start);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('an active session already exists'),
    );

    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('shows an error when ending a session fails and keeps the session state', async () => {
    const active = session({ state: 'monitoring' });
    api.getActiveSession.mockResolvedValue(active);
    api.endSession.mockRejectedValue(new Error('cannot transition session'));
    render(<App />);

    const end = screen.getByRole('button', { name: 'End Session' });
    await waitFor(() => expect(end).toBeEnabled());

    await userEvent.click(end);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('cannot transition session'),
    );

    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('monitoring')).toBeInTheDocument();
  });
});

describe('App session states', () => {
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

  it('polls for session state changes', async () => {
    vi.stubEnv('VITE_SESSION_POLL_INTERVAL_MS', '60');
    api.getActiveSession.mockResolvedValue(null);
    render(<App />);

    await waitFor(() => expect(api.getActiveSession).toHaveBeenCalledTimes(1));
    await waitFor(
      () => expect(api.getActiveSession.mock.calls.length).toBeGreaterThanOrEqual(2),
      { timeout: 4000 },
    );
  });

  it('shows a Fix your posture message while blocked and clears it after recovery', async () => {
    vi.stubEnv('VITE_SESSION_POLL_INTERVAL_MS', '60');
    api.getActiveSession
      .mockResolvedValueOnce(session({ state: 'blocked' }))
      .mockResolvedValue(session({ state: 'monitoring' }));
    render(<App />);

    await waitFor(() => expect(screen.getByText('Fix your posture.')).toBeInTheDocument());

    await waitFor(() => expect(screen.queryByText('Fix your posture.')).not.toBeInTheDocument(), {
      timeout: 4000,
    });

    expect(api.getActiveSession.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('App live events', () => {
  it('shows a slouch_violation event from the active session', async () => {
    api.getActiveSession.mockResolvedValue(session({ state: 'monitoring' }));
    eventsApi.getEvents.mockResolvedValue([event({ type: 'slouch_violation' })]);
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText('Posture violation detected')).toBeInTheDocument(),
    );
    expect(eventsApi.getEvents).toHaveBeenCalledWith(SESSION_ID);
  });

  it('shows a correction_requested event from the active session', async () => {
    api.getActiveSession.mockResolvedValue(session({ state: 'monitoring' }));
    eventsApi.getEvents.mockResolvedValue([event({ type: 'correction_requested' })]);
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText('Posture correction requested')).toBeInTheDocument(),
    );
  });

  it('shows both violation and correction events in order', async () => {
    api.getActiveSession.mockResolvedValue(session({ state: 'monitoring' }));
    eventsApi.getEvents.mockResolvedValue([
      event({
        id: 'e2e1f0d0-0000-4000-8000-000000000001',
        type: 'slouch_violation',
        timestamp: '2026-09-13T10:05:00.000Z',
      }),
      event({
        id: 'e2e1f0d0-0000-4000-8000-000000000002',
        type: 'correction_requested',
        timestamp: '2026-09-13T10:08:00.000Z',
      }),
    ]);
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText('Posture violation detected')).toBeInTheDocument(),
    );
    expect(screen.getByText('Posture correction requested')).toBeInTheDocument();
  });

  it('polls for new events on the configured interval', async () => {
    vi.stubEnv('VITE_EVENT_POLL_INTERVAL_MS', '60');
    api.getActiveSession.mockResolvedValue(session({ state: 'monitoring' }));
    eventsApi.getEvents.mockResolvedValue([]);
    render(<App />);

    await waitFor(() => expect(eventsApi.getEvents).toHaveBeenCalledTimes(1));
    await waitFor(
      () => expect(eventsApi.getEvents.mock.calls.length).toBeGreaterThanOrEqual(2),
      { timeout: 4000 },
    );
  });

  it('shows a loading state while events are being fetched', async () => {
    api.getActiveSession.mockResolvedValue(session({ state: 'monitoring' }));
    eventsApi.getEvents.mockImplementation(() => new Promise(() => {}));
    render(<App />);

    await waitFor(() => expect(screen.getByText('Loading events…')).toBeInTheDocument());
  });

  it('shows an error when loading events fails', async () => {
    api.getActiveSession.mockResolvedValue(session({ state: 'monitoring' }));
    eventsApi.getEvents.mockRejectedValue(new Error('MongoDB is not connected'));
    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Events error: MongoDB is not connected',
      ),
    );
  });
});

describe('App statistics', () => {
  it('renders duration, violations, and corrections for an active session', async () => {
    api.getActiveSession.mockResolvedValue(session({ state: 'monitoring' }));
    statisticsApi.getStatistics.mockResolvedValue(
      statistics({ durationSeconds: 7200, violationCount: 3, correctionCount: 2 }),
    );
    render(<App />);

    const section = screen.getByLabelText('Session statistics');
    await waitFor(() => expect(section).toHaveTextContent('2h'));
    expect(section).toHaveTextContent('Violations:');
    expect(section).toHaveTextContent('3');
    expect(section).toHaveTextContent('Corrections:');
    expect(section).toHaveTextContent('2');
    expect(statisticsApi.getStatistics).toHaveBeenCalledWith(SESSION_ID);
  });

  it('renders event history alongside the statistics', async () => {
    api.getActiveSession.mockResolvedValue(session({ state: 'monitoring' }));
    eventsApi.getEvents.mockResolvedValue([event({ type: 'slouch_violation' })]);
    statisticsApi.getStatistics.mockResolvedValue(
      statistics({ durationSeconds: 300, violationCount: 1, correctionCount: 1 }),
    );
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText('Posture violation detected')).toBeInTheDocument(),
    );
    const section = screen.getByLabelText('Session statistics');
    expect(section).toHaveTextContent('5m 0s');
    expect(section).toHaveTextContent('1');
  });

  it('renders an empty state when no session exists', async () => {
    api.getActiveSession.mockResolvedValue(null);
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText('Start a session to see statistics.')).toBeInTheDocument(),
    );
    expect(statisticsApi.getStatistics).not.toHaveBeenCalled();
  });

  it('shows a loading state while statistics are being fetched', async () => {
    api.getActiveSession.mockResolvedValue(session({ state: 'monitoring' }));
    statisticsApi.getStatistics.mockImplementation(() => new Promise(() => {}));
    render(<App />);

    await waitFor(() => expect(screen.getByText('Loading statistics…')).toBeInTheDocument());
  });

  it('shows an error when loading statistics fails', async () => {
    api.getActiveSession.mockResolvedValue(session({ state: 'monitoring' }));
    statisticsApi.getStatistics.mockRejectedValue(new Error('MongoDB is not connected'));
    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Statistics error: MongoDB is not connected',
      ),
    );
  });

  it('keeps the final statistics visible after the session ends', async () => {
    const active = session({ state: 'monitoring' });
    const ended = session({ state: 'ended', endedAt: '2026-09-13T11:00:00.000Z' });
    api.getActiveSession.mockResolvedValueOnce(active).mockResolvedValueOnce(null);
    api.endSession.mockResolvedValue(ended);
    statisticsApi.getStatistics.mockResolvedValue(
      statistics({ durationSeconds: 3600, violationCount: 2, correctionCount: 1, endedAt: '2026-09-13T11:00:00.000Z' }),
    );
    render(<App />);

    const end = screen.getByRole('button', { name: 'End Session' });
    await waitFor(() => expect(end).toBeEnabled());

    await userEvent.click(end);

    await waitFor(() => expect(api.endSession).toHaveBeenCalledWith(SESSION_ID));
    await waitFor(() => expect(screen.getByText('idle')).toBeInTheDocument());

    const section = screen.getByLabelText('Session statistics');
    expect(section).toHaveTextContent('1h');
    expect(section).toHaveTextContent('2');
    expect(section).toHaveTextContent('1');
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

    const section = await screen.findByLabelText('Detection settings');
    await waitFor(() => expect(within(section).getByLabelText(/Slouch threshold/i)).toBeInTheDocument());

    expect(within(section).getByLabelText(/Slouch threshold/i)).toHaveValue(0.15);
    expect(within(section).getByLabelText(/Slouch duration/i)).toHaveValue(2.0);
    expect(within(section).getByLabelText(/Correction duration/i)).toHaveValue(2.0);
  });

  it('shows a loading state while settings are being fetched', async () => {
    settingsApi.getSettings.mockImplementation(() => new Promise(() => {}));
    render(<App />);

    await waitFor(() => expect(screen.getByText('Loading settings…')).toBeInTheDocument());
  });

  it('shows an error when loading settings fails', async () => {
    settingsApi.getSettings.mockRejectedValue(new Error('MongoDB is not connected'));
    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Settings error: MongoDB is not connected'),
    );
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

  it('shows saving state while the PUT is in flight', async () => {
    settingsApi.getSettings.mockResolvedValue(defaultSettings());
    settingsApi.updateSettings.mockImplementation(() => new Promise(() => {}));
    render(<App />);

    const saveBtn = await screen.findByRole('button', { name: /Save settings/i });
    await waitFor(() => expect(saveBtn).not.toBeDisabled());

    await userEvent.click(saveBtn);

    await waitFor(() => expect(screen.getByRole('button', { name: /Saving…/i })).toBeInTheDocument());
  });

  it('shows an error when saving settings fails', async () => {
    settingsApi.getSettings.mockResolvedValue(defaultSettings());
    settingsApi.updateSettings.mockRejectedValue(new Error('slouchThreshold must be >= 0'));
    render(<App />);

    const saveBtn = await screen.findByRole('button', { name: /Save settings/i });
    await waitFor(() => expect(saveBtn).not.toBeDisabled());

    await userEvent.click(saveBtn);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('slouchThreshold must be >= 0'),
    );
  });

  it('existing session behavior remains intact alongside the settings section', async () => {
    api.getActiveSession.mockResolvedValue(session({ state: 'monitoring' }));
    render(<App />);

    await waitFor(() => expect(screen.getByText('monitoring')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText('Detection settings')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'End Session' })).toBeInTheDocument();
  });
});