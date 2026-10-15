/** Read the proxy's *single* authoritative, atomically published configuration.
 *
 * A journal in progress is a transaction boundary: never synthesize a mixture of
 * old and new metadata from the compatibility files while it exists.
 *
 * Legacy installations (without proxy.state.json) remain readable. They have no
 * atomic publication guarantee; we compare two full snapshots and fail closed
 * when we can observe a change. New installations should use the commit record.
 */
import * as path from 'node:path';
import { parseProcessMarker, type ProcessMarker } from './lifecycle.js';
import { equalState, journalPath, regularFile, STATE_NAMES } from './startup-journal.js';

export const COMMIT_NAME = 'proxy.state.json' as const;

export interface CommittedProxyState {
  port: number;
  tls: boolean;
  tld: string;
  marker: ProcessMarker | null;
  /** Older installations that have not yet published an atomic record. */
  legacy: boolean;
}

export class PendingStartupTransactionError extends Error {
  constructor(readonly stateDir: string) {
    super(`Proxy startup transaction is pending in ${stateDir}; recover it under the operation lock before reading state`);
    this.name = 'PendingStartupTransactionError';
  }
}

function validPort(port: unknown): port is number {
  return Number.isSafeInteger(port) && (port as number) >= 1 && (port as number) <= 65535;
}
function validTld(tld: unknown): tld is string {
  return typeof tld === 'string' && /^[a-z0-9]{1,63}$/.test(tld);
}

/** Serialize the record in the transaction; this file must be published LAST. */
export function encodeCommittedState(state: Omit<CommittedProxyState, 'legacy'>): Buffer {
  if (!validPort(state.port) || typeof state.tls !== 'boolean' || !validTld(state.tld) || !state.marker) {
    throw new TypeError('Invalid committed proxy state');
  }
  const parsed = parseProcessMarker(JSON.stringify(state.marker));
  if (!parsed) throw new TypeError('Invalid committed proxy owner marker');
  return Buffer.from(JSON.stringify({ version: 1, port: state.port, tls: state.tls, tld: state.tld, marker: parsed }) + '\n');
}

export function decodeCommittedState(raw: Buffer): CommittedProxyState {
  let data: unknown;
  try { data = JSON.parse(raw.toString('utf8')); }
  catch { throw new Error('Invalid committed proxy state; manual inspection required'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid committed proxy state; manual inspection required');
  }
  const value = data as Record<string, unknown>;
  const marker = value.marker && typeof value.marker === 'object'
    ? parseProcessMarker(JSON.stringify(value.marker))
    : null;
  if (value.version !== 1 || !validPort(value.port) || typeof value.tls !== 'boolean' ||
      !validTld(value.tld) || !marker) {
    throw new Error('Invalid committed proxy state; manual inspection required');
  }
  return { port: value.port, tls: value.tls, tld: value.tld, marker, legacy: false };
}

function pending(dir: string): void {
  if (regularFile(journalPath(dir), 1024 * 1024) !== null) throw new PendingStartupTransactionError(dir);
}

/** Return an all-or-nothing state view; never silently default a corrupt record. */
export function readCommittedProxyState(dir: string): CommittedProxyState | null {
  pending(dir);
  const raw = regularFile(path.join(dir, COMMIT_NAME));
  if (raw !== null) {
    const value = decodeCommittedState(raw);
    pending(dir);
    return value;
  }

  // Backwards compatibility: read every old file together, before and after.
  const names = STATE_NAMES.filter(name => name !== COMMIT_NAME);
  const readLegacy = () => names.map(name => regularFile(path.join(dir, name)));
  const first = readLegacy();
  const second = readLegacy();
  pending(dir);
  if (!first.every((value, i) => equalState(value, second[i]))) {
    throw new Error('Proxy state changed during legacy read; retry');
  }
  const [portBytes, tlsBytes, tldBytes, pidBytes] = first;
  if (!portBytes && !tlsBytes && !tldBytes && !pidBytes) return null;
  if (!portBytes) throw new Error('Incomplete legacy proxy state: missing port');
  const portText = portBytes.toString('utf8').trim();
  const port = /^\d{1,5}$/.test(portText) ? Number(portText) : NaN;
  if (!validPort(port)) throw new Error('Invalid legacy proxy port');
  if (tlsBytes && tlsBytes.toString('utf8').trim() !== '1') throw new Error('Invalid legacy TLS marker');
  const tld = tldBytes ? tldBytes.toString('utf8').trim() : 'localhost';
  if (!validTld(tld)) throw new Error('Invalid legacy proxy TLD');
  // Legacy numeric PID files are not trusted as proof of process identity.
  const marker = pidBytes ? parseProcessMarker(pidBytes.toString('utf8')) : null;
  return { port, tls: tlsBytes !== null, tld, marker, legacy: true };
}
