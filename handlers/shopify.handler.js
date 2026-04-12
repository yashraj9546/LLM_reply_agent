/**
 * handlers/shopify.handler.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Core business logic for processing Shopify event payloads.
 *
 * DESIGN PRINCIPLE — Decoupled Entry Point:
 *   These handlers receive a NORMALIZED event shape. The real Shopify webhook
 *   routes will parse and normalize the raw webhook body before calling these
 *   same functions — so zero changes are needed here when going live.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { sessionManager } = require('../services/session.service.mock');

/**
 * Handles a Shopify cart_update event.
 *
 * Called when a user's cart changes (item added/removed via Shopify storefront).
 *
 * @param {object} event
 * @param {string}   event.waId     - WhatsApp ID of the customer.
 * @param {object[]} event.cartItems - Array of cart line items.
 */
async function handleCartUpdate({ waId, cartItems }) {
  console.log(`[Shopify] Cart update for ${waId} — ${cartItems.length} item(s)`);

  // Clear cart and rebuild from the incoming payload
  const session = await sessionManager.getOrCreateSession(waId);

  // If new cart has items, add them (simplified: replace strategy)
  if (cartItems.length > 0) {
    for (const item of cartItems) {
      await sessionManager.addToCart(waId, item);
    }
  } else {
    // Empty cart → mark as idle
    await sessionManager.clearCart(waId);
  }

  return { success: true, waId, itemCount: cartItems.length };
}

/**
 * Handles a Shopify order_paid event.
 *
 * Called when the orders/create or orders/paid webhook fires.
 * Marks the customer's session as 'ordered' and clears the cart.
 *
 * @param {object} event
 * @param {string} event.waId    - WhatsApp ID of the customer.
 * @param {string} event.orderId - Shopify order ID.
 */
async function handleOrderPaid({ waId, orderId }) {
  console.log(`[Shopify] Order ${orderId} PAID for ${waId} — clearing cart`);

  await sessionManager.markAsOrdered(waId);

  return { success: true, waId, orderId };
}

module.exports = { handleCartUpdate, handleOrderPaid };
