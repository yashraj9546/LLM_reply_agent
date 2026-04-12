/**
 * controllers/mock.controller.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Express controller that handles the POST /mock/webhook route.
 *
 * Supported event types (passed in the request body as `eventType`):
 *   • "incoming_whatsapp_msg"   → Simulates a WhatsApp user message
 *   • "shopify_cart_update"     → Simulates a Shopify cart change
 *   • "shopify_order_paid"      → Simulates a Shopify order paid confirmation
 *
 * DESIGN PRINCIPLE:
 *   This controller is ONLY responsible for:
 *     1. Validating and normalizing the incoming request body.
 *     2. Routing to the correct core handler.
 *     3. Sending the HTTP response.
 *
 *   All business logic lives in handlers/. When you switch to real webhooks,
 *   you create a new controller (e.g. meta.controller.js / shopify.controller.js)
 *   that parses the real webhook body and calls the same handlers.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { handleIncomingMessage } = require('../handlers/whatsapp.handler');
const { handleCartUpdate, handleOrderPaid } = require('../handlers/shopify.handler');

// ── Event type constants ──────────────────────────────────────────────────────

const EVENT_TYPES = Object.freeze({
  INCOMING_WHATSAPP_MSG: 'incoming_whatsapp_msg',
  SHOPIFY_CART_UPDATE: 'shopify_cart_update',
  SHOPIFY_ORDER_PAID: 'shopify_order_paid',
});

// ── Controller ────────────────────────────────────────────────────────────────

/**
 * POST /mock/webhook
 *
 * Body schema (all event types share the `eventType` discriminator):
 *
 * incoming_whatsapp_msg:
 *   { "eventType": "incoming_whatsapp_msg", "waId": "+14155551234", "messageText": "Do you have earbuds?" }
 *
 * shopify_cart_update:
 *   { "eventType": "shopify_cart_update", "waId": "+14155551234",
 *     "cartItems": [{ "variantId": "v1", "productId": "p1", "title": "AirWave Pro", "quantity": 1, "price": "49.99", "currency": "USD" }] }
 *
 * shopify_order_paid:
 *   { "eventType": "shopify_order_paid", "waId": "+14155551234", "orderId": "ORD-9001" }
 */
async function handleMockWebhook(req, res) {
  const { eventType, ...payload } = req.body;

  if (!eventType) {
    return res.status(400).json({
      error: 'Missing required field: eventType',
      validTypes: Object.values(EVENT_TYPES),
    });
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[MockWebhook] Event received: ${eventType}`);
  console.log(`[MockWebhook] Payload:`, JSON.stringify(payload, null, 2));
  console.log('─'.repeat(60));

  try {
    switch (eventType) {

      // ── Incoming WhatsApp message ───────────────────────────────────────────
      case EVENT_TYPES.INCOMING_WHATSAPP_MSG: {
        const { waId, messageText } = payload;

        if (!waId || !messageText) {
          return res.status(400).json({
            error: 'incoming_whatsapp_msg requires: waId, messageText',
          });
        }

        const result = await handleIncomingMessage({ waId, messageText });

        return res.status(200).json({
          success: true,
          eventType,
          result,
        });
      }

      // ── Shopify cart update ─────────────────────────────────────────────────
      case EVENT_TYPES.SHOPIFY_CART_UPDATE: {
        const { waId, cartItems } = payload;

        if (!waId || !Array.isArray(cartItems)) {
          return res.status(400).json({
            error: 'shopify_cart_update requires: waId (string), cartItems (array)',
          });
        }

        const result = await handleCartUpdate({ waId, cartItems });

        return res.status(200).json({
          success: true,
          eventType,
          result,
        });
      }

      // ── Shopify order paid ──────────────────────────────────────────────────
      case EVENT_TYPES.SHOPIFY_ORDER_PAID: {
        const { waId, orderId } = payload;

        if (!waId || !orderId) {
          return res.status(400).json({
            error: 'shopify_order_paid requires: waId, orderId',
          });
        }

        const result = await handleOrderPaid({ waId, orderId });

        return res.status(200).json({
          success: true,
          eventType,
          result,
        });
      }

      // ── Unknown event type ──────────────────────────────────────────────────
      default:
        return res.status(400).json({
          error: `Unknown eventType: "${eventType}"`,
          validTypes: Object.values(EVENT_TYPES),
        });
    }
  } catch (err) {
    console.error(`[MockWebhook] Error processing "${eventType}":`, err);
    return res.status(500).json({
      success: false,
      eventType,
      error: err.message,
    });
  }
}

module.exports = { handleMockWebhook };
