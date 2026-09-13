const express = require('express');
const config = require('./config');

const app = express();

app.get('/api/status', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'postureguard-backend',
    uptime: Math.round(process.uptime()),
  });
});

if (require.main === module) {
  app.listen(config.port, config.host, () => {
    console.log(`postureguard-backend listening on http://${config.host}:${config.port}`);
  });
}

module.exports = app;