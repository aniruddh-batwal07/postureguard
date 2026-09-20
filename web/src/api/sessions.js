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

export async function createSession(arg) {
  let friendlyName = undefined;
  let baseline = undefined;
  if (typeof arg === 'string') {
    friendlyName = arg;
  } else if (arg && typeof arg === 'object') {
    friendlyName = arg.friendlyName;
    baseline = arg.baseline;
  }
  const options = {
    method: 'POST',
  };
  const payload = {};
  if (friendlyName) payload.friendlyName = friendlyName;
  if (baseline) payload.baseline = baseline;
  if (Object.keys(payload).length > 0) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(payload);
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

export async function setSessionBaseline(baseline) {
  const res = await fetch(`${API_BASE_URL}/api/sessions/active/baseline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseline }),
  });
  const body = await readResponse(res);
  return body.session;
}

export async function getCvStatus() {
  const res = await fetch(`${API_BASE_URL}/api/cv/status`);
  return readResponse(res);
}

export async function startCv(options = {}) {
  const res = await fetch(`${API_BASE_URL}/api/cv/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  return readResponse(res);
}

export async function stopCv() {
  const res = await fetch(`${API_BASE_URL}/api/cv/stop`, {
    method: 'POST',
  });
  return readResponse(res);
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