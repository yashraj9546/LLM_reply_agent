/**
 * services/session.service.mock.js
 * ─────────────────────────────────────────────────────────────────────────────
 * MOCK implementation of the Session Manager.
 *
 * What it simulates:
 *   - An in-memory Map standing in for the Supabase `user_sessions` table.
 *   - All the same function signatures as the production session.service.ts.
 *   - The abandoned-cart detection logic runs against in-memory timestamps.
 *
 * SWAP STRATEGY:
 *   Replace this file with the compiled production `session.service.js`
 *   (or point the require path to it). The handlers that call `sessionManager.*`
 *   remain 100% unchanged.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ── In-Memory "Database" ──────────────────────────────────────────────────────

/** @type {Map<string, object>} waId → UserSession */
const db = new Map();

/** Threshold in ms before a pending cart is considered "abandoned". */
const ABANDON_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

// ── Helpers ───────────────────────────────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

/**
 * Creates a fresh session object for a given WhatsApp ID.
 * @param {string} waId
 * @returns {object}
 */
function createFreshSession(waId) {
  return {
    id: `mock_${Math.random().toString(36).slice(2, 10)}`,
    wa_id: waId,
    cart: [],
    status: 'idle',        // idle | pending | ordered
    nudge_sent: false,
    last_message: null,
    created_at: now(),
    updated_at: now(),
  };
}

// ── Core CRUD ─────────────────────────────────────────────────────────────────

/**
 * Returns an existing session or creates a new one.
 * @param {string} waId
 * @returns {Promise<object>}
 */
async function getOrCreateSession(waId) {
  if (!db.has(waId)) {
    const session = createFreshSession(waId);
    db.set(waId, session);
    console.log(`[Session:Mock] Created new session for ${waId}`);
  }
  return db.get(waId);
}

/**
 * Records the latest message text and touches updated_at.
 * @param {string} waId
 * @param {string} lastMessage
 */
async function touchSession(waId, lastMessage) {
  const session = await getOrCreateSession(waId);
  session.last_message = lastMessage;
  session.updated_at = now();
  console.log(`[Session:Mock] Touched session for ${waId}`);
}

/**
 * Adds an item to the cart (or increments quantity if already present).
 * Sets status → 'pending' and resets nudge flag.
 *
 * @param {string} waId
 * @param {{ variantId: string, productId: string, title: string, quantity: number, price: string, currency: string }} item
 * @returns {Promise<object>}
 */
async function addToCart(waId, item) {
  const session = await getOrCreateSession(waId);
  const idx = session.cart.findIndex((c) => c.variantId === item.variantId);

  if (idx >= 0) {
    session.cart[idx].quantity += item.quantity;
  } else {
    session.cart.push({ ...item });
  }

  session.status = 'pending';
  session.nudge_sent = false;
  session.updated_at = now();

  console.log(`[Session:Mock] AddToCart: ${item.title} (qty ${item.quantity}) → ${waId}`);
  return session;
}

/**
 * Removes an item from the cart by variantId.
 * If cart becomes empty, status reverts to 'idle'.
 *
 * @param {string} waId
 * @param {string} variantId
 * @returns {Promise<object>}
 */
async function removeFromCart(waId, variantId) {
  const session = await getOrCreateSession(waId);
  session.cart = session.cart.filter((c) => c.variantId !== variantId);
  session.status = session.cart.length === 0 ? 'idle' : 'pending';
  session.updated_at = now();
  console.log(`[Session:Mock] RemoveFromCart: variantId=${variantId} from ${waId}`);
  return session;
}

/**
 * Empties the cart and resets status to 'idle'.
 * Convenience method used by the Shopify handler when cart becomes empty.
 *
 * @param {string} waId
 */
async function clearCart(waId) {
  const session = await getOrCreateSession(waId);
  session.cart = [];
  session.status = 'idle';
  session.updated_at = now();
  console.log(`[Session:Mock] Cleared cart for ${waId}`);
}

/**
 * Marks the session as 'ordered' and clears the cart.
 * Called when the Shopify orders/paid webhook fires.
 *
 * @param {string} waId
 */
async function markAsOrdered(waId) {
  const session = await getOrCreateSession(waId);
  session.status = 'ordered';
  session.cart = [];
  session.nudge_sent = false;
  session.updated_at = now();
  console.log(`[Session:Mock] Marked as ORDERED for ${waId}`);
}

// ── Proactive Trigger Logic ───────────────────────────────────────────────────

/**
 * Returns all sessions eligible for an abandoned-cart nudge:
 *   - status === 'pending'
 *   - updated_at older than ABANDON_THRESHOLD_MS
 *   - nudge_sent === false
 *
 * @returns {Promise<object[]>}
 */
async function findAbandonedCarts() {
  const threshold = Date.now() - ABANDON_THRESHOLD_MS;
  const abandoned = [];

  for (const session of db.values()) {
    if (
      session.status === 'pending' &&
      !session.nudge_sent &&
      new Date(session.updated_at).getTime() < threshold
    ) {
      abandoned.push(session);
    }
  }

  console.log(`[Session:Mock] findAbandonedCarts → ${abandoned.length} session(s) found`);
  return abandoned;
}

/**
 * Prevents the same user from receiving duplicate nudges.
 * Call immediately after dispatching a nudge message.
 *
 * @param {string} waId
 */
async function markNudgeSent(waId) {
  const session = await getOrCreateSession(waId);
  session.nudge_sent = true;
  session.updated_at = now();
  console.log(`[Session:Mock] NudgeSent flagged for ${waId}`);
}

/**
 * Builds a human-readable WhatsApp nudge message for an abandoned cart.
 *
 * @param {object} session
 * @returns {string}
 */
function buildAbandonedCartMessage(session) {
  if (!session.cart || session.cart.length === 0) return 'Your cart is empty.';

  const lines = session.cart.map(
    (item) => `  • ${item.title} x${item.quantity} (${item.price} ${item.currency})`,
  );

  return [
    `👋 Hey! You left ${session.cart.length} item(s) in your cart:`,
    ...lines,
    '',
    "🛒 Ready to complete your order? Just reply *YES* and I'll take care of the rest!",
  ].join('\n');
}

/**
 * Debug helper — dumps all in-memory sessions.
 * Remove or gate behind NODE_ENV in production.
 *
 * @returns {object[]}
 */
function dumpAllSessions() {
  return Array.from(db.values());
}

// ── Exports ───────────────────────────────────────────────────────────────────

const sessionManager = {
  getOrCreateSession,
  touchSession,
  addToCart,
  removeFromCart,
  clearCart,
  markAsOrdered,
  findAbandonedCarts,
  markNudgeSent,
  buildAbandonedCartMessage,
  dumpAllSessions,
};

module.exports = { sessionManager };
