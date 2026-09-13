const express = require('express');
const config = require('./config');
const mongo = require('./persistence/mongo');
const createStatusRouter = require('./routes/status');

function createApp({ persistence = mongo } = {}) {
  const app = express();

  app.use(express.json());
  app.use('/api', createStatusRouter(persistence));

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error('[app] unhandled error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  });

  return app;
}

const app = createApp();

if (require.main === module) {
  const server = app.listen(config.port, config.host, () => {
    console.log(`postureguard-backend listening on http://${config.host}:${config.port}`);
  });

  mongo.connect().then(
    () => console.log(`[mongo] connected to ${config.mongoUri}`),
    (err) => console.error(`[mongo] initial connection failed (${config.mongoUri}): ${err.message}`),
  );

  async function shutdown() {
    server.close(async () => {
      await mongo.disconnect().catch(() => {});
      process.exit(0);
    });
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = app;
module.exports.createApp = createApp;