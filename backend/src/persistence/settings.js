'use strict';

const { MongoDBUnavailableError, toMongoUnavailable } = require('./mongo');

/**
 * Settings persistence — a single document in the ``settings`` collection
 * keyed by ``_id: 'global'``.  Mirrors the pattern from sessions.js and
 * events.js: thin wrapper that surfaces MongoDB errors as MongoDBUnavailableError.
 */
function createSettingsStore(persistence) {
  function collection() {
    const db = persistence.getDb();
    if (!db) {
      throw new MongoDBUnavailableError('MongoDB is not connected; cannot persist settings');
    }
    return db.collection('settings');
  }

  /**
   * Find the stored settings document, or null if none exists yet.
   */
  async function findSettings() {
    try {
      return await collection().findOne({ _id: 'global' });
    } catch (err) {
      throw toMongoUnavailable(err);
    }
  }

  /**
   * Upsert the settings document, merging ``patch`` into the existing values.
   * Returns the full resulting document.
   */
  async function upsertSettings(patch) {
    try {
      const result = await collection().findOneAndUpdate(
        { _id: 'global' },
        { $set: patch },
        { upsert: true, returnDocument: 'after' },
      );
      return result;
    } catch (err) {
      throw toMongoUnavailable(err);
    }
  }

  return { findSettings, upsertSettings };
}

module.exports = { createSettingsStore };
