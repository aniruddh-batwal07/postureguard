const express = require('express');
const mongo = require('../persistence/mongo');

const SERVICE_NAME = 'postureguard-backend';

function createStatusRouter(persistence = mongo) {
  const router = express.Router();

  router.get('/status', async (_req, res) => {
    let mongoStatus;
    try {
      mongoStatus = await persistence.status();
    } catch (err) {
      mongoStatus = { connected: false, error: err.message };
    }
    res.json({
      status: 'ok',
      service: SERVICE_NAME,
      uptime: Math.round(process.uptime()),
      mongo: mongoStatus,
    });
  });

  return router;
}

module.exports = createStatusRouter;