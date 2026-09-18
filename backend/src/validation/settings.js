'use strict';

const { ALLOWED_SETTINGS_KEYS, SETTINGS_DEFAULTS } = require('../settings/defaults');

/**
 * Validation ranges for each editable setting.
 *
 * slouchThreshold    : [0, 1]   — deviation magnitude; 0 means "always bad" (valid edge case)
 * slouchDurationSeconds    : (0, 60]  — must be positive and finite
 * correctionDurationSeconds: (0, 60]  — must be positive and finite
 */
const FIELD_RULES = {
  slouchThreshold: {
    validate(v) {
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'slouchThreshold must be a finite number';
      if (v < 0) return 'slouchThreshold must be >= 0';
      if (v > 1) return 'slouchThreshold must be <= 1';
      return null;
    },
  },
  slouchDurationSeconds: {
    validate(v) {
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'slouchDurationSeconds must be a finite number';
      if (v <= 0) return 'slouchDurationSeconds must be > 0';
      if (v > 60) return 'slouchDurationSeconds must be <= 60';
      return null;
    },
  },
  correctionDurationSeconds: {
    validate(v) {
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'correctionDurationSeconds must be a finite number';
      if (v <= 0) return 'correctionDurationSeconds must be > 0';
      if (v > 60) return 'correctionDurationSeconds must be <= 60';
      return null;
    },
  },
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate a PUT /api/settings request body.
 *
 * Returns { ok: true, value: <partial settings object> } or { ok: false, error: <string> }.
 * Unknown fields are always rejected.
 * An empty body is accepted (no-op update).
 */
function validateSettingsUpdate(body) {
  if (!isPlainObject(body)) {
    return { ok: false, error: 'request body must be a JSON object' };
  }

  const unknown = Object.keys(body).filter((k) => !ALLOWED_SETTINGS_KEYS.includes(k));
  if (unknown.length > 0) {
    return { ok: false, error: `unknown field(s): ${unknown.join(', ')}` };
  }

  const validated = {};
  for (const key of ALLOWED_SETTINGS_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const err = FIELD_RULES[key].validate(body[key]);
    if (err) return { ok: false, error: err };
    validated[key] = body[key];
  }

  return { ok: true, value: validated };
}

module.exports = { validateSettingsUpdate, FIELD_RULES };
