const express = require('express');
const config = require('./config');
const mongo = require('./persistence/mongo');
const createStatusRouter = require('./routes/status');
const { createSessionStore } = require('./persistence/sessions');
const { createSessionService } = require('./sessions/service');
const createSessionsRouter = require('./routes/sessions');

function errorToResponse(err) {
  switch (err.code) {
    case 'SESSION_NOT_FOUND':
      return { status: 404, body: { error: err.message } };
    case 'ACTIVE_SESSION_EXISTS':
    case 'INVALID_TRANSITION':
      return { status: 409, body: { error: err.message } };
    case 'MONGO_UNAVAILABLE':
      return { status: 503, body: { error: err.message } };
    default:
      return null;
  }
}

function createApp({ persistence = mongo, sessionService } = {}) {
  const store = createSessionStore(persistence);
  const sessions = sessionService || createSessionService({ store });

  const app = express();

  app.use(express.json());
  app.use('/api', createStatusRouter(persistence));
  app.use('/api', createSessionsRouter(sessions));

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  app.use((err, _req, res, _next) => {
    const mapped = errorToResponse(err);
    if (mapped) {
      return res.status(mapped.status).json(mapped.body);
    }
    console.error('[app] unhandled error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
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