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

export async function getSettings() {
  const res = await fetch(`${API_BASE_URL}/api/settings`);
  const body = await readResponse(res);
  return body.settings;
}

export async function updateSettings(patch) {
  const res = await fetch(`${API_BASE_URL}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const body = await readResponse(res);
  return body.settings;
}
