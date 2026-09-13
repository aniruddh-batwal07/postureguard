const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.BACKEND_PORT) || 4000;
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/postureguard';

module.exports = { host, port, mongoUri };