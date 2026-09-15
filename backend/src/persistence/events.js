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

  return { insert };
}

module.exports = { createEventStore };