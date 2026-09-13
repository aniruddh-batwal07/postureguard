import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import * as api from '../src/api/sessions';

vi.mock('../src/api/sessions', () => ({
  getActiveSession: vi.fn(),
  createSession: vi.fn(),
  endSession: vi.fn(),
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

beforeEach(() => {
  vi.resetAllMocks();
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