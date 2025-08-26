// backend/server.js - minimal static server for index.html
require('dotenv').config();
const express = require('express');
const path = require('path');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- External API addresses ----
const USER_API_URL = process.env.USER_API_URL || 'http://goatedcodoer:8080/api/users';

// Serve static files from the project root (one level up from /backend)
const staticRoot = path.join(__dirname, '..');
app.use(express.static(staticRoot));

// Root route -> index.html
app.get('/', (_req, res) => {
  res.sendFile(path.join(staticRoot, 'index.html'));
});

// Health check
app.get('/health', (_req, res) => res.json({ ok: true }));

// Proxy to Java Users API to avoid CORS and centralize configuration
app.get('/api/users', (req, res) => {
  try {
    const target = USER_API_URL;
    const isHttps = target.startsWith('https://');
    const urlObj = new URL(target);

    // Merge query params from target URL and incoming request
    const incomingParams = new URLSearchParams(req.query || {});
    const outgoingParams = new URLSearchParams(urlObj.search);
    incomingParams.forEach((v, k) => outgoingParams.set(k, v));

    const pathWithQuery = urlObj.pathname + (outgoingParams.toString() ? '?' + outgoingParams.toString() : '');

    const options = {
      protocol: urlObj.protocol,
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: pathWithQuery,
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    };

    const client = isHttps ? https : http;
    const proxyReq = client.request(options, (proxyRes) => {
      res.status(proxyRes.statusCode || 500);
      if (proxyRes.headers['content-type']) {
        res.set('Content-Type', proxyRes.headers['content-type']);
      }
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('Proxy error /api/users ->', target, err);
      res.status(502).json({ error: 'Bad Gateway', details: err.message });
    });

    proxyReq.end();
  } catch (e) {
    console.error('Proxy configuration error:', e);
    res.status(500).json({ error: 'Proxy configuration error', details: String(e) });
  }
});

// Start server with retry if port is in use
const HOST = process.env.HOST || '0.0.0.0';
const START_PORT = Number(PORT) || 3000;
const PORT_RETRY_MAX = Number(process.env.PORT_RETRY_MAX || 10);

function tryListen(port, attemptsLeft) {
  const server = app.listen(port, HOST, () => {
    process.env.PORT = String(port);
    console.log(`Serving static files from: ${staticRoot}`);
    console.log(`Server listening on http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      const nextPort = port + 1;
      console.warn(`Port ${port} is in use. Trying port ${nextPort}... (${attemptsLeft - 1} retries left)`);
      setTimeout(() => tryListen(nextPort, attemptsLeft - 1), 200);
    } else {
      console.error('Failed to start server:', err);
      console.error('Tip: set PORT to an available port in backend/.env, or stop whatever is using the port.');
      process.exit(1);
    }
  });
}

tryListen(START_PORT, PORT_RETRY_MAX);
