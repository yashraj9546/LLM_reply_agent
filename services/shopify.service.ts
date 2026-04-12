// src/services/shopify.service.ts
import crypto from 'crypto';
import axios from 'axios';
import { prisma } from '../lib/prisma';
import { config } from '../config/env';

/**
 * Build the Shopify OAuth install URL.
 * The nonce is a random hex string stored in memory so we can verify the
 * callback belongs to this install. In production use Redis.
 */
const pendingNonces = new Map<string, string>(); // shop → nonce
const pendingUsers = new Map<string, string>();  // shop → userId

export function buildInstallUrl(shop: string, userId: string): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  pendingNonces.set(shop, nonce);
  pendingUsers.set(shop, userId);

  const params = new URLSearchParams({
    client_id: config.shopifyApiKey,
    scope: config.shopifyScopes,
    redirect_uri: config.shopifyRedirectUri,
    state: nonce,
    'grant_options[]': 'per-user',
  });

  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

/**
 * Verify the HMAC signature Shopify attaches to the callback query string.
 */
export function verifyHmac(query: Record<string, string>): boolean {
  const { hmac, ...rest } = query;
  if (!hmac) return false;

  // Sort keys and build the message
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('&');

  const digest = crypto
    .createHmac('sha256', config.shopifyApiSecret)
    .update(message)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

/**
 * Exchange the OAuth code for a permanent access token and persist the store.
 */
export async function handleCallback(
  shop: string,
  code: string,
  state: string
): Promise<{ shop: string; userId: string }> {
  // 1. Verify nonce
  const expectedNonce = pendingNonces.get(shop);
  if (!expectedNonce || expectedNonce !== state) {
    const err: any = new Error('Invalid OAuth state / nonce mismatch');
    err.statusCode = 403;
    throw err;
  }
  pendingNonces.delete(shop);

  // 2. Get the user who initiated the install
  const userId = pendingUsers.get(shop);
  if (!userId) {
    const err: any = new Error('No pending install found for this shop');
    err.statusCode = 403;
    throw err;
  }
  pendingUsers.delete(shop);

  // 3. Exchange code for access token
  const response = await axios.post<{ access_token: string }>(
    `https://${shop}/admin/oauth/access_token`,
    {
      client_id: config.shopifyApiKey,
      client_secret: config.shopifyApiSecret,
      code,
    }
  );

  const accessToken = response.data.access_token;

  // 4. Upsert the store row (supports reinstallation)
  await prisma.store.upsert({
    where: { shop },
    update: { accessToken, userId, installedAt: new Date() },
    create: { shop, accessToken, userId },
  });

  return { shop, userId };
}
