'use strict';

const { SETTINGS_DEFAULTS } = require('./defaults');
const { MongoDBUnavailableError } = require('../persistence/mongo');

/**
 * Settings service (M3.3).
 *
 * getSettings():    returns current settings, falling back to defaults when
 *                   Mongo is unavailable (never throws for a missing document).
 *                   Throws MongoDBUnavailableError on a Mongo connectivity
 *                   failure during a PUT so the route can surface a 503.
 *
 * updateSettings(): merges the patch into the stored document and returns the
 *                   full resulting settings object.  Throws
 *                   MongoDBUnavailableError when Mongo is down.
 */
function createSettingsService({ store }) {
  /**
   * Merge the stored document (may be null) with defaults so callers always
   * get a complete settings object.
   */
  function toSettings(doc) {
    return {
      slouchThreshold: doc?.slouchThreshold ?? SETTINGS_DEFAULTS.slouchThreshold,
      slouchDurationSeconds: doc?.slouchDurationSeconds ?? SETTINGS_DEFAULTS.slouchDurationSeconds,
      correctionDurationSeconds: doc?.correctionDurationSeconds ?? SETTINGS_DEFAULTS.correctionDurationSeconds,
    };
  }

  async function getSettings() {
    let doc = null;
    try {
      doc = await store.findSettings();
    } catch (err) {
      if (err instanceof MongoDBUnavailableError) {
        // GET degrades gracefully: return defaults rather than a 503.
        return toSettings(null);
      }
      throw err;
    }
    return toSettings(doc);
  }

  async function updateSettings(patch) {
    // updateSettings always needs Mongo; let the MongoDBUnavailableError
    // bubble so the route maps it to 503.
    await store.upsertSettings(patch);
    // Re-read via getSettings to produce the full merged object.
    // (upsertSettings returns the document, but toSettings covers the merge
    // logic in one place, so we re-read for correctness.)
    const doc = await store.findSettings();
    return toSettings(doc);
  }

  return { getSettings, updateSettings };
}

module.exports = { createSettingsService };
