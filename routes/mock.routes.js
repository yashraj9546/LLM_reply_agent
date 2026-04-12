/**
 * routes/mock.routes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Express router for all /mock/* routes.
 *
 * Routes:
 *   POST /mock/webhook      → Simulates incoming events (WhatsApp / Shopify)
 *   GET  /mock/sessions     → Debug: dumps all in-memory session state
 *   GET  /mock/abandoned    → Debug: lists sessions eligible for nudge
 *   GET  /mock/health       → Health check
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { Router } = require('express');
const { handleMockWebhook } = require('../controllers/mock.controller');
const { sessionManager } = require('../services/session.service.mock');

const router = Router();

// ── Main simulated webhook endpoint ──────────────────────────────────────────
router.post('/webhook', handleMockWebhook);

// ── Debug: dump all sessions ──────────────────────────────────────────────────
router.get('/sessions', (_req, res) => {
  const sessions = sessionManager.dumpAllSessions();
  res.json({
    count: sessions.length,
    sessions,
  });
});

// ── Debug: find abandoned carts ───────────────────────────────────────────────
router.get('/abandoned', async (_req, res) => {
  try {
    const abandoned = await sessionManager.findAbandonedCarts();
    const messages = abandoned.map((s) => ({
      waId: s.wa_id,
      nudgeMessage: sessionManager.buildAbandonedCartMessage(s),
      session: s,
    }));

    res.json({
      count: abandoned.length,
      abandoned: messages,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    mode: 'mock',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
