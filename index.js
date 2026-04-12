
/**
 * index.js — Mock Server Entry Point
 * ─────────────────────────────────────────────────────────────────────────────
 * Project X — Mock API server for local development.
 *
 * This is the ONLY file that changes when you move to production.
 * It wires up the Express app and registers routes. All business logic
 * lives in handlers/, services/, and controllers/.
 *
 * Start with:  node index.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const mockRoutes = require('./routes/mock.routes');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ── Request logger ────────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/mock', mockRoutes);

// ── 404 catch-all ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found. See /mock/health for available endpoints.' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  Project X — Mock Server running on port ${PORT}           ║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  Endpoints:                                              ║');
  console.log('║  POST /mock/webhook    → Simulate events                 ║');
  console.log('║  GET  /mock/sessions   → Dump session state              ║');
  console.log('║  GET  /mock/abandoned  → List abandoned carts            ║');
  console.log('║  GET  /mock/health     → Health check                    ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
});

module.exports = app;
