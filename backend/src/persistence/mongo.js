const { MongoClient } = require('mongodb');
const config = require('../config');

class MongoDBUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MongoDBUnavailableError';
    this.code = 'MONGO_UNAVAILABLE';
  }
}

function extractDbName(uri) {
  try {
    const path = new URL(uri).pathname;
    const name = decodeURIComponent(path.replace(/^\//, ''));
    return name || 'postureguard';
  } catch {
    return 'postureguard';
  }
}

let client = null;
let db = null;

async function connect({ uri = config.mongoUri, serverSelectionTimeoutMS = config.mongoServerSelectionTimeoutMS } = {}) {
  if (client && db) {
    return db;
  }
  const nextClient = new MongoClient(uri, {
    serverSelectionTimeoutMS,
    appName: 'postureguard-backend',
  });
  await nextClient.connect();
  client = nextClient;
  db = nextClient.db(extractDbName(uri));
  return db;
}

function getDb() {
  return db;
}

function isConnected() {
  return Boolean(client && db);
}

async function ping() {
  if (!isConnected()) {
    throw new MongoDBUnavailableError('MongoDB is not connected');
  }
  try {
    await db.command({ ping: 1 });
  } catch (err) {
    throw new MongoDBUnavailableError(`MongoDB ping failed: ${err.message}`);
  }
}

async function status() {
  try {
    await ping();
    return { connected: true };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

async function disconnect() {
  if (client) {
    const toClose = client;
    client = null;
    db = null;
    await toClose.close();
  }
}

module.exports = {
  connect,
  disconnect,
  getDb,
  isConnected,
  ping,
  status,
  MongoDBUnavailableError,
};