const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.BACKEND_PORT) || 4000;
const webPort = Number(process.env.WEB_PORT) || 5173;
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/postureguard';
const mongoServerSelectionTimeoutMS = Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS) || 5000;
const cameraIndex = Number(process.env.CAMERA_INDEX) || 0;
const defaultSerialPort = process.platform === 'win32' ? 'COM13' : '/dev/ttyACM0';
const serialPort = process.env.ARDUINO_SERIAL_PORT || defaultSerialPort;
const hardwareCommandTimeoutMs = Number(process.env.HARDWARE_COMMAND_TIMEOUT_MS) || 30000;


module.exports = {
  host,
  port,
  webPort,
  mongoUri,
  mongoServerSelectionTimeoutMS,
  cameraIndex,
  serialPort,
  hardwareCommandTimeoutMs,
};