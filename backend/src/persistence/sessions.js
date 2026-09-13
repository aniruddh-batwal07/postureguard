const { MongoDBUnavailableError } = require('./mongo');

function createSessionStore(persistence) {
  function collection() {
    const db = persistence.getDb();
    if (!db) {
      throw new MongoDBUnavailableError('MongoDB is not connected; cannot persist sessions');
    }
    return db.collection('sessions');
  }

  async function insert(session) {
    await collection().insertOne(session);
    return session;
  }

  async function findBySessionId(sessionId) {
    return collection().findOne({ sessionId });
  }

  async function findActive() {
    return collection().findOne({ state: { $ne: 'ended' } }, { sort: { createdAt: -1 } });
  }

  async function updateState(sessionId, changes) {
    return collection().findOneAndUpdate(
      { sessionId },
      { $set: changes },
      { returnDocument: 'after' },
    );
  }

  return { insert, findBySessionId, findActive, updateState };
}

module.exports = { createSessionStore };