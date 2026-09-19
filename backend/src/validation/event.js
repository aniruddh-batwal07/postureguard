const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// M3.1 detection events plus the M4.2 baseline lifecycle event. A successful
// baseline capture (CV) posts baseline_captured; the backend marks the session
// monitoring (architecture.md §5.2).
const SUPPORTED_TYPES = ['slouch_violation', 'correction_requested', 'baseline_captured'];
const ALLOWED_KEYS = ['sessionId', 'type', 'timestamp', 'data'];
const MAX_FUTURE_SKEW_MS = 60_000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidTimestamp(value, now) {
  if (typeof value !== 'string' || value.length === 0) return false;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  return parsed <= now.getTime() + MAX_FUTURE_SKEW_MS;
}

function validateEvent(body, { now = () => new Date() } = {}) {
  if (!isPlainObject(body)) {
    return { ok: false, error: 'event body must be a JSON object' };
  }

  const unexpected = Object.keys(body).filter((key) => !ALLOWED_KEYS.includes(key));
  if (unexpected.length > 0) {
    return { ok: false, error: `unexpected key(s): ${unexpected.join(', ')}` };
  }

  const { sessionId, type, timestamp, data } = body;

  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    return { ok: false, error: 'sessionId must be a valid UUID' };
  }

  if (!SUPPORTED_TYPES.includes(type)) {
    return { ok: false, error: `unsupported event type "${type}"; supported: ${SUPPORTED_TYPES.join(', ')}` };
  }

  if (!isValidTimestamp(timestamp, now())) {
    return { ok: false, error: 'timestamp must be an ISO-8601 string in the past or near-present' };
  }

  if (Object.prototype.hasOwnProperty.call(body, 'data') && !isPlainObject(data)) {
    return { ok: false, error: 'data must be a JSON object when provided' };
  }

  const value = { sessionId, type, timestamp: new Date(Date.parse(timestamp)) };
  if (Object.prototype.hasOwnProperty.call(body, 'data')) {
    value.data = data;
  }
  return { ok: true, value };
}

module.exports = { validateEvent, SESSION_ID_PATTERN, SUPPORTED_TYPES };