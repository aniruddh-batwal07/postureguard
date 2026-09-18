'use strict';

/**
 * Default values and allowed field list for the M3.3 settings API.
 *
 * These mirror the CV defaults in cv/src/cv/config.py so that a fresh
 * backend (no stored document) and a fresh CV process agree on the starting
 * configuration without requiring an explicit PUT.
 */

const SETTINGS_DEFAULTS = Object.freeze({
  slouchThreshold: 0.15,
  slouchDurationSeconds: 2.0,
  correctionDurationSeconds: 2.0,
});

/** Every field the settings API accepts. Unknown keys are rejected. */
const ALLOWED_SETTINGS_KEYS = Object.keys(SETTINGS_DEFAULTS);

module.exports = { SETTINGS_DEFAULTS, ALLOWED_SETTINGS_KEYS };
