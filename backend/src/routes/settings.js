'use strict';

const express = require('express');
const { validateSettingsUpdate } = require('../validation/settings');

function createSettingsRouter(service) {
  const router = express.Router();

  /**
   * GET /api/settings
   *
   * Returns current settings. Falls back to defaults when Mongo is
   * unavailable so the dashboard always gets a usable response.
   */
  router.get('/settings', async (_req, res, next) => {
    try {
      const settings = await service.getSettings();
      res.json({ settings });
    } catch (err) {
      next(err);
    }
  });

  /**
   * PUT /api/settings
   *
   * Updates one or more settings fields. Unknown fields and invalid values
   * are rejected with 400. Returns the full (merged) settings object on
   * success.
   */
  router.put('/settings', async (req, res, next) => {
    const result = validateSettingsUpdate(req.body);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    try {
      const settings = await service.updateSettings(result.value);
      res.json({ settings });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = createSettingsRouter;
