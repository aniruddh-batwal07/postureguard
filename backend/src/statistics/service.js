const { SessionNotFoundError } = require('../sessions/service');

const VIOLATION_TYPES = ['slouch_violation', 'phone_violation'];
const CORRECTION_TYPES = ['correction_requested'];

function countOf(counts, types) {
  return types.reduce((total, type) => total + (counts[type] || 0), 0);
}

function computeViolationDurationMs(events, session, currentTime) {
  if (!events || events.length === 0) return 0;
  const sorted = [...events].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  let totalMs = 0;
  let activeStart = null;

  for (const ev of sorted) {
    const ts = new Date(ev.timestamp).getTime();
    if (VIOLATION_TYPES.includes(ev.type)) {
      if (activeStart === null) {
        activeStart = ts;
      }
    } else if (CORRECTION_TYPES.includes(ev.type)) {
      if (activeStart !== null) {
        totalMs += Math.max(0, ts - activeStart);
        activeStart = null;
      }
    }
  }

  if (activeStart !== null) {
    const endTs = session.endedAt ? new Date(session.endedAt).getTime() : currentTime.getTime();
    totalMs += Math.max(0, endTs - activeStart);
  }

  return totalMs;
}

function createStatisticsService({ sessionStore, eventStore, now = () => new Date() }) {
  async function getStatistics(sessionId) {
    const session = await sessionStore.findBySessionId(sessionId);
    if (!session) {
      throw new SessionNotFoundError(`session ${sessionId} not found`);
    }

    const counts = await eventStore.countsBySession(sessionId);
    const events = eventStore.listBySession
      ? await eventStore.listBySession(sessionId, { limit: 10000 })
      : [];
    const currentTime = now();
    const startTime = session.createdAt;
    const endTime = session.endedAt || currentTime;
    const durationMs = Math.max(0, endTime.getTime() - startTime.getTime());
    const violationDurationMs = computeViolationDurationMs(events, session, currentTime);

    return {
      sessionId,
      durationSeconds: Math.round(durationMs / 1000),
      violationCount: countOf(counts, VIOLATION_TYPES),
      correctionCount: countOf(counts, CORRECTION_TYPES),
      violationDurationSeconds: Math.round(violationDurationMs / 1000),
      startedAt: startTime,
      endedAt: session.endedAt || null,
    };
  }

  return { getStatistics };
}

module.exports = { createStatisticsService };