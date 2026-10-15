import { createHmac, timingSafeEqual } from 'node:crypto';
import { assertId } from './validation.js';
export function createSignedMediaToken(id: string, secret: string | Uint8Array, expiresAt: number): string {
  assertId(id);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw new RangeError('Expiration must be in the future');
  if (!secret || (typeof secret === 'string' && secret.length < 16) || (typeof secret !== 'string' && secret.length < 16)) throw new TypeError('Secret must be at least 16 bytes');
  const payload = `${id}.${expiresAt}`;
  const mac = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}
export function verifySignedMediaToken(token: string, secret: string | Uint8Array, now = Date.now()): string | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.'); if (parts.length !== 3) return null;
  const [id, expires, mac] = parts;
  if (!/^[0-9]+$/.test(expires) || !Number.isSafeInteger(Number(expires)) || Number(expires) <= now) return null;
  try { assertId(id); } catch { return null; }
  const expected = createHmac('sha256', secret).update(`${id}.${expires}`).digest();
  if (!/^[a-zA-Z0-9_-]{43}$/.test(mac)) return null;
  const actual = Buffer.from(mac, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return id;
}
