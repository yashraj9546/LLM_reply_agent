/**
 * session.service.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Proactive Session Manager — backed by Supabase
 *
 * Responsibilities:
 *   1. Upsert/read a user session (cart state + last_interaction).
 *   2. Add / remove items from the cart.
 *   3. Detect "abandoned cart" sessions for proactive nudge scheduling.
 *
 * Supabase table required (run once in your Supabase SQL editor):
 * ──────────────────────────────────────────────────────────────
 *   CREATE TABLE user_sessions (
 *     id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     wa_id          TEXT UNIQUE NOT NULL,          -- WhatsApp phone number
 *     cart           JSONB        NOT NULL DEFAULT '[]',
 *     status         TEXT         NOT NULL DEFAULT 'idle',  -- idle | pending | ordered
 *     nudge_sent     BOOLEAN      NOT NULL DEFAULT FALSE,
 *     last_message   TEXT,
 *     created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
 *     updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
 *   );
 *
 *   -- Auto-update updated_at on any row change
 *   CREATE OR REPLACE FUNCTION update_updated_at_column()
 *   RETURNS TRIGGER AS $$
 *   BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
 *   $$ LANGUAGE plpgsql;
 *
 *   CREATE TRIGGER set_updated_at
 *   BEFORE UPDATE ON user_sessions
 *   FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ── Supabase client (singleton) ───────────────────────────────────────────────

const supabase: SupabaseClient = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string, // service-role key bypasses RLS
);

// ── Constants ─────────────────────────────────────────────────────────────────

/** A cart is considered "abandoned" after this many minutes of inactivity. */
const ABANDON_THRESHOLD_MINUTES = 120; // 2 hours

const TABLE = 'user_sessions';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SessionStatus = 'idle' | 'pending' | 'ordered';

export interface CartItem {
  variantId: string;
  productId: string;
  title: string;
  quantity: number;
  price: string;
  currency: string;
}

export interface UserSession {
  id: string;
  wa_id: string;
  cart: CartItem[];
  status: SessionStatus;
  nudge_sent: boolean;
  last_message: string | null;
  created_at: string;
  updated_at: string;
}

// ── Core CRUD ─────────────────────────────────────────────────────────────────

/**
 * Fetches an existing session OR creates a fresh one for a given WhatsApp ID.
 * This is idempotent — safe to call on every incoming message.
 */
export async function getOrCreateSession(waId: string): Promise<UserSession> {
  // Try to find existing session
  const { data: existing, error: fetchError } = await supabase
    .from(TABLE)
    .select('*')
    .eq('wa_id', waId)
    .maybeSingle();

  if (fetchError) throw new Error(`[SessionManager] Fetch error: ${fetchError.message}`);

  if (existing) return existing as UserSession;

  // Create fresh session
  const { data: created, error: insertError } = await supabase
    .from(TABLE)
    .insert({ wa_id: waId, cart: [], status: 'idle', nudge_sent: false })
    .select()
    .single();

  if (insertError) throw new Error(`[SessionManager] Insert error: ${insertError.message}`);

  return created as UserSession;
}

/**
 * Records the user's most recent message and refreshes updated_at.
 * Call this on EVERY incoming WhatsApp message.
 */
export async function touchSession(
  waId: string,
  lastMessage: string,
): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({ last_message: lastMessage })
    .eq('wa_id', waId);

  if (error) throw new Error(`[SessionManager] Touch error: ${error.message}`);
}

/**
 * Updates the cart with a new item (or increments quantity if the item exists).
 * Sets session status to 'pending' automatically.
 */
export async function addToCart(
  waId: string,
  item: CartItem,
): Promise<UserSession> {
  const session = await getOrCreateSession(waId);

  const existingIndex = session.cart.findIndex(
    (c) => c.variantId === item.variantId,
  );

  let updatedCart: CartItem[];
  if (existingIndex >= 0) {
    updatedCart = session.cart.map((c, i) =>
      i === existingIndex ? { ...c, quantity: c.quantity + item.quantity } : c,
    );
  } else {
    updatedCart = [...session.cart, item];
  }

  const { data, error } = await supabase
    .from(TABLE)
    .update({ cart: updatedCart, status: 'pending', nudge_sent: false })
    .eq('wa_id', waId)
    .select()
    .single();

  if (error) throw new Error(`[SessionManager] AddToCart error: ${error.message}`);

  return data as UserSession;
}

/**
 * Removes an item from the cart by variantId.
 * If the cart becomes empty, status reverts to 'idle'.
 */
export async function removeFromCart(
  waId: string,
  variantId: string,
): Promise<UserSession> {
  const session = await getOrCreateSession(waId);

  const updatedCart = session.cart.filter((c) => c.variantId !== variantId);
  const newStatus: SessionStatus = updatedCart.length === 0 ? 'idle' : 'pending';

  const { data, error } = await supabase
    .from(TABLE)
    .update({ cart: updatedCart, status: newStatus })
    .eq('wa_id', waId)
    .select()
    .single();

  if (error) throw new Error(`[SessionManager] RemoveFromCart error: ${error.message}`);

  return data as UserSession;
}

/**
 * Marks the session as 'ordered' and clears the cart.
 * Call this when the shopify/orders_create webhook fires.
 */
export async function markAsOrdered(waId: string): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({ status: 'ordered', cart: [], nudge_sent: false })
    .eq('wa_id', waId);

  if (error) throw new Error(`[SessionManager] MarkOrdered error: ${error.message}`);
}

// ── Proactive Trigger Logic ───────────────────────────────────────────────────

/**
 * Identifies ALL sessions where:
 *   - status = 'pending'      (user has items in cart)
 *   - updated_at < NOW() - 2h (no activity for 2+ hours)
 *   - nudge_sent = false      (we haven't already sent a nudge)
 *
 * This is designed to be called by a scheduled job (e.g. node-cron every 15 min).
 * After sending the nudge, call markNudgeSent(waId) to prevent double-sends.
 */
export async function findAbandonedCarts(): Promise<UserSession[]> {
  const thresholdTime = new Date(
    Date.now() - ABANDON_THRESHOLD_MINUTES * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('status', 'pending')
    .eq('nudge_sent', false)
    .lt('updated_at', thresholdTime);

  if (error) throw new Error(`[SessionManager] AbandonedCarts error: ${error.message}`);

  return (data ?? []) as UserSession[];
}

/**
 * Flags a session so the nudge is not sent again.
 * Call immediately AFTER successfully dispatching the WhatsApp nudge message.
 */
export async function markNudgeSent(waId: string): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({ nudge_sent: true })
    .eq('wa_id', waId);

  if (error) throw new Error(`[SessionManager] MarkNudge error: ${error.message}`);
}

/**
 * Returns a plain summary of a session's cart for use in WhatsApp nudge messages.
 *
 * @example
 * "You left 2 item(s) in your cart:\n- Blue Sneakers x1 ($49.99)\n- White Tee x2 ($19.99)"
 */
export function buildAbandonedCartMessage(session: UserSession): string {
  if (session.cart.length === 0) return "Your cart is empty.";

  const lines = session.cart.map(
    (item) => `  • ${item.title} x${item.quantity} (${item.price} ${item.currency})`,
  );

  return [
    `👋 Hey! You left ${session.cart.length} item(s) in your cart:`,
    ...lines,
    '',
    '🛒 Ready to complete your order? Just reply *YES* and I\'ll take care of the rest!',
  ].join('\n');
}
