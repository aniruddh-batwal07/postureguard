const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.BACKEND_PORT) || 4000;
const webPort = Number(process.env.WEB_PORT) || 5173;
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/postureguard';
const cameraIndex = Number(process.env.CAMERA_INDEX) || 0;
const serialPort = process.env.ARDUINO_SERIAL_PORT || '/dev/ttyACM0';

module.exports = { host, port, webPort, mongoUri, cameraIndex, serialPort };