const { MongoDBUnavailableError, toMongoUnavailable } = require('./mongo');

function createSessionStore(persistence) {
  function collection() {
    const db = persistence.getDb();
    if (!db) {
      throw new MongoDBUnavailableError('MongoDB is not connected; cannot persist sessions');
    }
    return db.collection('sessions');
  }

  async function insert(session) {
    try {
      await collection().insertOne(session);
      return session;
    } catch (err) {
      throw toMongoUnavailable(err);
    }
  }

  async function findBySessionId(sessionId) {
    try {
      return await collection().findOne({ sessionId });
    } catch (err) {
      throw toMongoUnavailable(err);
    }
  }

  async function findActive() {
    try {
      return await collection().findOne({ state: { $ne: 'ended' } }, { sort: { createdAt: -1 } });
    } catch (err) {
      throw toMongoUnavailable(err);
    }
  }

  async function updateState(sessionId, changes) {
    try {
      return await collection().findOneAndUpdate(
        { sessionId },
        { $set: changes },
        { returnDocument: 'after' },
      );
    } catch (err) {
      throw toMongoUnavailable(err);
    }
  }

  return { insert, findBySessionId, findActive, updateState };
}

module.exports = { createSessionStore };