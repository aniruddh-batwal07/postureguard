const { SessionNotFoundError } = require('../sessions/service');

const VIOLATION_TYPES = ['slouch_violation', 'phone_violation'];
const CORRECTION_TYPES = ['correction_requested'];

function countOf(counts, types) {
  return types.reduce((total, type) => total + (counts[type] || 0), 0);
}

function createStatisticsService({ sessionStore, eventStore, now = () => new Date() }) {
  async function getStatistics(sessionId) {
    const session = await sessionStore.findBySessionId(sessionId);
    if (!session) {
      throw new SessionNotFoundError(`session ${sessionId} not found`);
    }

    const counts = await eventStore.countsBySession(sessionId);
    const startTime = session.createdAt;
    const endTime = session.endedAt || now();
    const durationMs = Math.max(0, endTime.getTime() - startTime.getTime());

    return {
      sessionId,
      durationSeconds: Math.round(durationMs / 1000),
      violationCount: countOf(counts, VIOLATION_TYPES),
      correctionCount: countOf(counts, CORRECTION_TYPES),
      startedAt: startTime,
      endedAt: session.endedAt || null,
    };
  }

  return { getStatistics };
}

module.exports = { createStatisticsService };