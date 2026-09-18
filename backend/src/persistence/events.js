const { MongoDBUnavailableError, toMongoUnavailable } = require('./mongo');

function createEventStore(persistence) {
  function collection() {
    const db = persistence.getDb();
    if (!db) {
      throw new MongoDBUnavailableError('MongoDB is not connected; cannot persist events');
    }
    return db.collection('events');
  }

  async function insert(event) {
    try {
      await collection().insertOne(event);
      return event;
    } catch (err) {
      throw toMongoUnavailable(err);
    }
  }

  async function listBySession(sessionId, { limit = 100 } = {}) {
    try {
      const docs = await collection()
        .find({ sessionId })
        .sort({ createdAt: -1, timestamp: -1 })
        .limit(limit)
        .toArray();
      return docs.reverse();
    } catch (err) {
      throw toMongoUnavailable(err);
    }
  }

  async function countsBySession(sessionId) {
    try {
      const rows = await collection()
        .aggregate([
          { $match: { sessionId } },
          { $group: { _id: '$type', count: { $sum: 1 } } },
        ])
        .toArray();
      const counts = {};
      for (const row of rows) {
        counts[row._id] = row.count;
      }
      return counts;
    } catch (err) {
      throw toMongoUnavailable(err);
    }
  }

  return { insert, listBySession, countsBySession };
}

module.exports = { createEventStore };