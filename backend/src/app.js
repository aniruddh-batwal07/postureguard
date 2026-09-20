const express = require('express');
const config = require('./config');
const mongo = require('./persistence/mongo');
const createStatusRouter = require('./routes/status');
const { createSessionStore } = require('./persistence/sessions');
const { createEventStore } = require('./persistence/events');
const { createSettingsStore } = require('./persistence/settings');
const { createSessionService } = require('./sessions/service');
const { createEventService } = require('./events/service');
const { createStatisticsService } = require('./statistics/service');
const { createSettingsService } = require('./settings/service');
const createSessionsRouter = require('./routes/sessions');
const createEventsRouter = require('./routes/events');
const createStatisticsRouter = require('./routes/statistics');
const createSettingsRouter = require('./routes/settings');

function errorToResponse(err) {
  switch (err.code) {
    case 'SESSION_NOT_FOUND':
      return { status: 404, body: { error: err.message } };
    case 'ACTIVE_SESSION_EXISTS':
    case 'INVALID_TRANSITION':
    case 'SESSION_NOT_ACTIVE':
      return { status: 409, body: { error: err.message } };
    case 'MONGO_UNAVAILABLE':
      return { status: 503, body: { error: err.message } };
    default:
      return null;
  }
}

function createApp({ persistence = mongo, sessionService, eventService, statisticsService, settingsService, hardware } = {}) {
  const store = createSessionStore(persistence);
  const eventStore = createEventStore(persistence);
  const settingsStore = createSettingsStore(persistence);
  const sessions = sessionService || createSessionService({ store, hardware });
  const events = eventService || createEventService({
    store: eventStore,
    findSessionById: store.findBySessionId,
    // Baseline completion always moves the session to monitoring (independent
    // of hardware). Violations drive the mock arm only when hardware is
    // configured; otherwise the event service degrades to recording events
    // only (fail-safe: never pretend to block).
    markBaselineCaptured: sessions.markBaselineCaptured,
    blockSession: hardware ? sessions.blockSession : null,
    retrieveSession: hardware ? sessions.retrieveSession : null,
  });
  const statistics = statisticsService || createStatisticsService({
    sessionStore: store,
    eventStore,
  });
  const settings = settingsService || createSettingsService({ store: settingsStore });

  const app = express();

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  app.use(express.json());
  app.use('/api', createStatusRouter(persistence));
  app.use('/api', createSessionsRouter(sessions, statistics));
  app.use('/api', createEventsRouter(events));
  app.use('/api', createStatisticsRouter(statistics));
  app.use('/api', createSettingsRouter(settings));

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed' || err.status === 400) {
      return res.status(400).json({ error: 'invalid JSON body' });
    }
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

async function startServer() {
  let hardware = null;
  let transport = null;

  if (process.env.ENABLE_HARDWARE !== 'false') {
    const { createSerialTransport } = require('./hardware/transport');
    const { createHardwareService } = require('./hardware/service');
    const targetPort = config.serialPort;
    transport = createSerialTransport({ path: targetPort });
    hardware = createHardwareService({ transport, commandTimeoutMs: config.hardwareCommandTimeoutMs });
    try {
      console.log(`[hardware] attempting connection on ${targetPort}...`);
      await transport.open();
      const currentStatus = await hardware.status().catch(() => ({ state: 'unknown' }));
      console.log(`[hardware] Arduino connected on ${targetPort} (status: ${currentStatus.state})`);
      // Initial homing to ensure arm is at dock/base position upon startup
      await hardware.retrieve().catch((err) => {
        console.warn(`[hardware] initial homing on startup: ${err.message}`);
      });
    } catch (hwErr) {
      console.warn(`[hardware] Arduino not yet connected on ${targetPort} (${hwErr.message}). Ready to auto-connect on demand when plugged in.`);
    }
  }

  let persistence = mongo;
  try {
    await mongo.connect({ serverSelectionTimeoutMS: 2000 });
    console.log(`[mongo] connected to ${config.mongoUri}`);
  } catch (err) {
    console.warn(`[mongo] MongoDB unavailable at ${config.mongoUri} (${err.message}). Using in-memory persistence fallback.`);
    const { createInMemoryPersistence } = require('./persistence/in-memory');
    persistence = createInMemoryPersistence();
  }

  const liveApp = createApp({ hardware, persistence });
  const server = liveApp.listen(config.port, config.host, () => {
    console.log(`postureguard-backend listening on http://${config.host}:${config.port}`);
  });

  async function shutdown() {
    server.close(async () => {
      if (transport) {
        await transport.close().catch(() => {});
      }
      await persistence.disconnect().catch(() => {});
      process.exit(0);
    });
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('[app] startup failed:', err);
    process.exit(1);
  });
}

module.exports = app;
module.exports.createApp = createApp;