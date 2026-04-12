/**
 * handlers/whatsapp.handler.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Core business logic for processing an incoming WhatsApp message event.
 *
 * DESIGN PRINCIPLE — Decoupled Entry Point:
 *   This handler knows NOTHING about where the event came from (mock vs. real
 *   Meta webhook). It only cares about the normalized event shape:
 *     { waId: string, messageText: string }
 *
 *   When you get real Meta API credentials, you simply point your production
 *   webhook route at this same handler — zero changes needed here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { sessionManager } = require('../services/session.service.mock');
const { ragPipeline } = require('../services/rag.service.mock');

/**
 * Processes a normalized incoming WhatsApp message.
 *
 * @param {object} event
 * @param {string} event.waId        - The sender's WhatsApp phone number (E.164).
 * @param {string} event.messageText - Raw text sent by the user.
 * @returns {Promise<object>}          The reply payload to send back.
 */
async function handleIncomingMessage({ waId, messageText }) {
  console.log(`[WhatsApp] ← Message from ${waId}: "${messageText}"`);

  // 1. Ensure a session exists and record the latest message
  await sessionManager.touchSession(waId, messageText);

  // 2. Run the RAG pipeline to get a grounded AI response
  const { answer, products } = await ragPipeline.runRag(messageText);

  console.log(`[WhatsApp] → Reply to ${waId}: "${answer.slice(0, 80)}..."`);

  return {
    to: waId,
    replyText: answer,
    matchedProducts: products,
  };
}

module.exports = { handleIncomingMessage };
