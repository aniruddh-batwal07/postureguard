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

export async function getStatistics(sessionId) {
  const res = await fetch(`${API_BASE_URL}/api/statistics?sessionId=${encodeURIComponent(sessionId)}`);
  const body = await readResponse(res);
  return body.statistics;
}