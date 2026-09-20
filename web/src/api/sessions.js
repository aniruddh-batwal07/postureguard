const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

async function readResponse(res) {
  const data = await res.json().catch(() => null);
  if (res.ok) {
    return data;
  }
  const message =
    data && typeof data.error === 'string'
      ? data.error
      : `Request failed with status ${res.status}`;
  throw new Error(message);
}

export async function getActiveSession() {
  const res = await fetch(`${API_BASE_URL}/api/sessions/active`);
  const body = await readResponse(res);
  return body.session;
}

export async function createSession(friendlyName) {
  const options = {
    method: 'POST',
  };
  if (friendlyName) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify({ friendlyName });
  }
  const res = await fetch(`${API_BASE_URL}/api/sessions`, options);
  const body = await readResponse(res);
  return body.session;
}

export async function endSession(sessionId) {
  const res = await fetch(`${API_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}/end`, {
    method: 'POST',
  });
  const body = await readResponse(res);
  return body.session;
}

export async function captureBaseline() {
  const res = await fetch(`${API_BASE_URL}/api/sessions/active/baseline/capture`, {
    method: 'POST',
  });
  const body = await readResponse(res);
  return body.session;
}

export async function resetBaseline() {
  const res = await fetch(`${API_BASE_URL}/api/sessions/active/baseline/reset`, {
    method: 'POST',
  });
  const body = await readResponse(res);
  return body.session;
}

export async function getSessionHistory(limit = 20, skip = 0) {
  const res = await fetch(`${API_BASE_URL}/api/sessions/history?limit=${limit}&skip=${skip}`);
  const body = await readResponse(res);
  return body.sessions || [];
}