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
import {
  equalState,
  journalPath,
  regularFile,
  STATE_NAMES,
} from './startup-journal.js';

/** Fixed authoritative record leaf, published last after compatibility metadata. */
export const COMMIT_NAME = 'proxy.state.json' as const;

export interface CommittedProxyState {
  /** Validated listener port from one consistent state view. */
  port: number;
  /** Whether this state view declares TLS. */
  tls: boolean;
  /** Validated simple proxy hostname suffix. */
  tld: string;
  /** Validated process-identity marker when available; legacy numeric PIDs do not prove identity. */
  marker: ProcessMarker | null;
  /** Older installations that have not yet published an atomic record. */
  legacy: boolean;
}

/** Signals that readers must not guess partially published state or recover without the operation lock. */
export class PendingStartupTransactionError extends Error {
  /** Report an unfinished startup transaction without attempting recovery outside the required operation lock.
   * @param {string} stateDir - Host-owned directory whose journal must be inspected/recovered under the lock.
   */
  constructor(readonly stateDir: string) {
    super(
      `Proxy startup transaction is pending in ${stateDir}; recover it under the operation lock before reading state`
    );
    this.name = 'PendingStartupTransactionError';
  }
}

/** Validate the persisted proxy listener port without coercing unknown JSON values.
 * @param {unknown} port - Untrusted decoded port.
 * @returns {boolean} Whether port is a safe integer in the inclusive TCP port range.
 */
function validPort(port: unknown): port is number {
  return (
    Number.isSafeInteger(port) &&
    (port as number) >= 1 &&
    (port as number) <= 65535
  );
}
/** Validate the bounded lowercase suffix supported by this proxy-state format.
 * @param {unknown} tld - Untrusted decoded suffix.
 * @returns {boolean} Whether the suffix belongs to the existing simple label grammar.
 */
function validTld(tld: unknown): tld is string {
  return typeof tld === 'string' && /^[a-z0-9]{1,63}$/.test(tld);
}

/** Serialize a validated authoritative state record for publication last within the locked startup transaction.
 * @param {Omit<CommittedProxyState, 'legacy'>} state - Verified listener settings and required process-identity marker.
 * @returns {Buffer} Complete V1 JSON bytes; never writes or publishes the record itself.
 */
export function encodeCommittedState(
  state: Omit<CommittedProxyState, 'legacy'>
): Buffer {
  if (
    !validPort(state.port) ||
    typeof state.tls !== 'boolean' ||
    !validTld(state.tld) ||
    !state.marker
  ) {
    throw new TypeError('Invalid committed proxy state');
  }
  /** Validated process-marker representation copied into the candidate record. */
  const parsed = parseProcessMarker(JSON.stringify(state.marker));
  if (!parsed) {
    throw new TypeError('Invalid committed proxy owner marker');
  }
  return Buffer.from(
    JSON.stringify({
      version: 1,
      port: state.port,
      tls: state.tls,
      tld: state.tld,
      marker: parsed,
    }) + '\n'
  );
}

/** Validate an inert V1 authoritative record and its process-marker representation without trusting it as management permission.
 * @param {Buffer} raw - Bounded bytes read by the owning state-file helper.
 * @returns {CommittedProxyState} Validated nonlegacy state; malformed or incompatible records throw.
 */
export function decodeCommittedState(raw: Buffer): CommittedProxyState {
  let data: unknown;
  try {
    data = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new Error(
      'Invalid committed proxy state; manual inspection required'
    );
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(
      'Invalid committed proxy state; manual inspection required'
    );
  }
  /** Unknown parsed object whose required listener and marker fields are checked. */
  const value = data as Record<string, unknown>;
  /** Validated identity marker, or null when legacy identity evidence is absent. */
  const marker =
    value.marker && typeof value.marker === 'object'
      ? parseProcessMarker(JSON.stringify(value.marker))
      : null;
  if (
    value.version !== 1 ||
    !validPort(value.port) ||
    typeof value.tls !== 'boolean' ||
    !validTld(value.tld) ||
    !marker
  ) {
    throw new Error(
      'Invalid committed proxy state; manual inspection required'
    );
  }
  return {
    port: value.port,
    tls: value.tls,
    tld: value.tld,
    marker,
    legacy: false,
  };
}

/** Fail closed while the startup journal exists, requiring the lifecycle owner to recover it under its lock.
 * @param {string} dir - Host-owned proxy state directory.
 * @returns {void} Returns only when no journal is present.
 */
function pending(dir: string): void {
  if (regularFile(journalPath(dir), 1024 * 1024) !== null) {
    throw new PendingStartupTransactionError(dir);
  }
}

/** Read authoritative state without mixing compatibility files; legacy reads compare two complete fixed-name snapshots.
 * @param {string} dir - Host-owned proxy state directory whose access policy remains with the lifecycle owner.
 * @returns {CommittedProxyState | null} Validated committed/legacy view or null when empty; observable inconsistency/corruption rejects.
 */
export function readCommittedProxyState(
  dir: string
): CommittedProxyState | null {
  pending(dir);
  /** Bounded authoritative candidate bytes, if the fixed record exists. */
  const raw = regularFile(path.join(dir, COMMIT_NAME));
  if (raw !== null) {
    /** Unknown parsed object whose required listener and marker fields are checked. */
    const value = decodeCommittedState(raw);
    pending(dir);
    return value;
  }

  // Backwards compatibility: read every old file together, before and after.
  /** Fixed compatibility-file order excluding the canonical commit record. */
  const names = STATE_NAMES.filter((name) => name !== COMMIT_NAME);
  /** Read all compatibility filenames in the same fixed order without defaults.
   * @returns {(Buffer | null)[]} One complete raw legacy snapshot; no file values are combined across calls.
   */
  const readLegacy = () =>
    names.map((name) => regularFile(path.join(dir, name)));
  /** First complete legacy snapshot retained for consistency comparison and decoding. */
  const first = readLegacy();
  /** Second snapshot from the identical fixed filename list, proving each compared index exists. */
  const second = readLegacy();
  pending(dir);
  if (!first.every((value, i) => equalState(value, second[i]!))) {
    throw new Error('Proxy state changed during legacy read; retry');
  }
  /** Compatibility bytes in the documented fixed order; absent required port rejects. */
  const [portBytes, tlsBytes, tldBytes, pidBytes] = first;
  if (!portBytes && !tlsBytes && !tldBytes && !pidBytes) {
    return null;
  }
  if (!portBytes) {
    throw new Error('Incomplete legacy proxy state: missing port');
  }
  /** Complete trimmed legacy port token, validated before numeric conversion. */
  const portText = portBytes.toString('utf8').trim();
  /** Validated numeric legacy port; partial decimal strings are rejected. */
  const port = /^\d{1,5}$/.test(portText) ? Number(portText) : NaN;
  if (!validPort(port)) {
    throw new Error('Invalid legacy proxy port');
  }
  if (tlsBytes && tlsBytes.toString('utf8').trim() !== '1') {
    throw new Error('Invalid legacy TLS marker');
  }
  /** Explicit valid legacy suffix or the retained localhost compatibility default. */
  const tld = tldBytes ? tldBytes.toString('utf8').trim() : 'localhost';
  if (!validTld(tld)) {
    throw new Error('Invalid legacy proxy TLD');
  }
  // Legacy numeric PID files are not trusted as proof of process identity.
  /** Validated identity marker, or null when legacy identity evidence is absent. */
  const marker = pidBytes
    ? parseProcessMarker(pidBytes.toString('utf8'))
    : null;
  return { port, tls: tlsBytes !== null, tld, marker, legacy: true };
}
