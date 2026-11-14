/** Durable publication of a proxy's startup state.
 * Must be invoked while holding the proxy operation lock and after bind succeeds.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createProcessMarker,
  markerMatchesProcess,
  parseProcessMarker,
  processExists,
  processIdentity,
} from './lifecycle.js';
import {
  encodeCommittedState,
  decodeCommittedState,
} from './committed-state.js';

export interface StartupState {
  /** Host-owned state directory protected by the operation lock. */
  stateDir: string;
  /** Successfully bound validated listener port. */
  port: number;
  /** Whether the bound listener uses TLS. */
  https: boolean;
  /** Validated application routing suffix. */
  tld: string;
}
export interface StartupPublication {
  /** Restore previous bytes only for files that still match this publication’s expected values.
   * @returns {void} Idempotent rollback; does not remove an unrelated competing writer’s changes.
   */
  rollback(): void;
}
import {
  STATE_NAMES as FILES,
  type StateName as StateFilename,
  regularFile as readRegular,
  atomicStateWrite as publish,
  snapshot,
  writeStartupJournal,
  clearStartupJournal,
  recoverStartupJournal,
} from './startup-journal.js';

/** Recover a previously journaled partial startup under the required host-held operation lock; live/unverifiable owners are never replaced.
 * @param {string} stateDir - Host-owned state directory already protected by the operation lock.
 * @returns {boolean} Whether an interrupted journal was recovered.
 */
export function recoverInterruptedStartup(stateDir: string): boolean {
  return recoverStartupJournal(stateDir, (raw) => {
    /** Current native process marker written before the authoritative committed state. */
    const marker = parseProcessMarker(raw);
    return (
      !marker ||
      (processExists(marker.pid) &&
        (markerMatchesProcess(marker) || processIdentity(marker.pid) === null))
    );
  });
}

/** Validate supported committed port and TLD before staging proxy startup metadata.
 * @param {StartupState} state - Trusted host configuration; directory safety and operation-lock ownership remain separate.
 * @returns {void} Throws for unsupported port/TLD settings.
 */
function validate(state: StartupState): void {
  if (
    !Number.isSafeInteger(state.port) ||
    state.port < 1 ||
    state.port > 65535
  ) {
    throw new RangeError('Invalid proxy startup port');
  }
  if (!/^[a-z0-9]{1,63}$/.test(state.tld)) {
    throw new TypeError('Invalid proxy TLD');
  }
}

/** Reject live or unverifiable canonical/legacy owners even if compatibility files were independently deleted.
 * @param {string} stateDir - Trusted private state directory protected by the operation lock.
 * @returns {void} Allows only absent or proven-stale ownership; it never signals or stops a process.
 */
export function assertStartupOwnership(stateDir: string): void {
  // The atomic commit record is authoritative, including when a legacy PID
  // file was removed or damaged independently.
  /** Optional bounded canonical owner record, inspected independently of legacy files. */
  const committedRaw = readRegular(path.join(stateDir, 'proxy.state.json'));
  // Prior installations may have only proxy.pid (and no proxy.port yet).
  // Ownership validation must still inspect those markers independently.
  /** Decoded authoritative owner record, if present. */
  const committed = committedRaw ? decodeCommittedState(committedRaw) : null;
  if (committed?.marker && processExists(committed.marker.pid)) {
    if (markerMatchesProcess(committed.marker)) {
      throw new Error(
        `Proxy state belongs to a live process (${committed.marker.pid})`
      );
    }
    if (processIdentity(committed.marker.pid) === null) {
      throw new Error('Cannot verify committed proxy owner');
    }
  }
  /** Optional legacy owner bytes; absence alone never bypasses canonical ownership. */
  const raw = readRegular(path.join(stateDir, 'proxy.pid'));
  if (!raw) {
    return;
  }
  /** Current native process marker written before the authoritative committed state. */
  const marker = parseProcessMarker(raw.toString('utf8'));
  if (!marker) {
    throw new Error('Unverifiable proxy PID marker; refusing to overwrite');
  }
  if (processExists(marker.pid) && markerMatchesProcess(marker)) {
    throw new Error(
      `Proxy PID marker belongs to a live process (${marker.pid})`
    );
  }
  // A live process with an unreadable fingerprint cannot be proven stale.
  if (processExists(marker.pid)) {
    if (processIdentity(marker.pid) === null) {
      throw new Error('Cannot verify existing proxy PID marker');
    }
  }
}

/** Publish compatibility files followed by the canonical commit with crash journal and conditional rollback; invoke only after successful bind while holding the operation lock.
 * @param {StartupState} state - Host-validated listener and private state publication settings.
 * @returns {StartupPublication} Conditional rollback receipt; this is filesystem publication, not a multi-service transaction.
 */
export function publishStartupState(state: StartupState): StartupPublication {
  validate(state);
  fs.mkdirSync(state.stateDir, { recursive: true, mode: 0o700 });
  recoverInterruptedStartup(state.stateDir);
  assertStartupOwnership(state.stateDir);
  /** Prior bytes for each fixed startup filename, retained for conditional rollback. */
  const old = new Map<StateFilename, Buffer | null>();
  for (const name of FILES) {
    old.set(name, readRegular(path.join(state.stateDir, name)));
  }
  /** Current native process marker written before the authoritative committed state. */
  const marker = createProcessMarker();
  /** Complete proposed fixed-file state including the authoritative final commit record. */
  const next = new Map<StateFilename, Buffer | null>([
    ['proxy.port', Buffer.from(`${state.port}\n`)],
    ['proxy.tls', state.https ? Buffer.from('1\n') : null],
    [
      'proxy.tld',
      state.tld === 'localhost' ? null : Buffer.from(`${state.tld}\n`),
    ],
    ['proxy.pid', Buffer.from(`${JSON.stringify(marker)}\n`)],
    [
      'proxy.state.json',
      encodeCommittedState({
        port: state.port,
        tls: state.https,
        tld: state.tld,
        marker,
      }),
    ],
  ]);
  /** Ordered filenames whose writes were attempted; reverse order drives rollback. */
  const modified: StateFilename[] = [];
  /** Complete prior fixed-file snapshot for crash recovery. */
  const before = snapshot(state.stateDir);
  /** Complete proposed snapshot for crash recovery. */
  const after = Object.fromEntries(next) as Record<
    StateFilename,
    Buffer | null
  >;
  writeStartupJournal(state.stateDir, before, after);
  /** Restore prior state only where current bytes still match this attempted publication.
   * @returns {void} Conditional per-file rollback; unexpected filesystem failures remain visible. */
  const revert = () => {
    for (const name of [...modified].reverse()) {
      /** Fixed startup file selected only from the internal allowlist. */
      const filename = path.join(state.stateDir, name);
      // A competing writer should never have its state removed by rollback.
      /** Proposed bytes or absence used to fence rollback against external edits. */
      const expected = next.get(name) ?? null;
      /** Current bounded fixed-file bytes compared before restoration. */
      const current = readRegular(filename);
      if (
        (current === null && expected === null) ||
        (current && expected && current.equals(expected))
      ) {
        publish(filename, old.get(name) ?? null);
      }
    }
  };
  try {
    for (const name of FILES) {
      modified.push(name);
      publish(path.join(state.stateDir, name), next.get(name) ?? null);
    }
    clearStartupJournal(state.stateDir);
  } catch (error) {
    try {
      revert();
      clearStartupJournal(state.stateDir);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'Proxy startup failed and state rollback was incomplete'
      );
    }
    throw error;
  }
  let rolledBack = false;
  return {
    /** Restore previous bytes only for files that still match this publication’s expected values.
     * @returns {void} Idempotent rollback; does not remove an unrelated competing writer’s changes.
     */
    rollback() {
      if (!rolledBack) {
        rolledBack = true;
        revert();
      }
    },
  };
}
