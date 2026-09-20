'use strict';

const express = require('express');

function createCvRouter(cvManager) {
  const router = express.Router();

  router.get('/cv/status', (_req, res) => {
    if (!cvManager) {
      return res.json({ running: false, pid: null, available: false });
    }
    const current = cvManager.status();
    res.json({ ...current, available: true });
  });

  router.post('/cv/start', async (req, res, next) => {
    try {
      if (!cvManager) {
        return res.status(503).json({ error: 'CV manager is not configured on this server' });
      }
      const noPreview = Boolean(req.body && req.body.noPreview);
      const result = await cvManager.start({ noPreview });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/cv/stop', async (_req, res, next) => {
    try {
      if (!cvManager) {
        return res.json({ running: false });
      }
      const result = await cvManager.stop();
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = createCvRouter;
