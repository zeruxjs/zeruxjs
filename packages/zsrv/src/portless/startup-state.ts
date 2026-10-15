/** Durable publication of a proxy's startup state.
 * Must be invoked while holding the proxy operation lock and after bind succeeds.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createProcessMarker, markerMatchesProcess, parseProcessMarker, processExists, processIdentity } from './lifecycle.js';
import { encodeCommittedState, decodeCommittedState } from './committed-state.js';

export interface StartupState { stateDir: string; port: number; https: boolean; tld: string }
export interface StartupPublication { rollback(): void }
import { STATE_NAMES as FILES, type StateName as StateFilename, regularFile as readRegular, atomicStateWrite as publish, snapshot, writeStartupJournal, clearStartupJournal, recoverStartupJournal } from './startup-journal.js';

/** Recover a prior interrupted startup while holding the operation lock. */
export function recoverInterruptedStartup(stateDir: string): boolean {
  return recoverStartupJournal(stateDir, raw => {
    const marker = parseProcessMarker(raw);
    return !marker || (processExists(marker.pid) && (markerMatchesProcess(marker) || processIdentity(marker.pid) === null));
  });
}

function validate(state: StartupState): void {
  if (!Number.isSafeInteger(state.port) || state.port < 1 || state.port > 65535) throw new RangeError('Invalid proxy startup port');
  if (!/^[a-z0-9]{1,63}$/.test(state.tld)) throw new TypeError('Invalid proxy TLD');
}

/** A valid marker belonging to another live process must never be replaced.
 * An invalid marker also requires manual inspection. Known-dead markers are recoverable.
 */
export function assertStartupOwnership(stateDir: string): void {
  // The atomic commit record is authoritative, including when a legacy PID
  // file was removed or damaged independently.
  const committedRaw = readRegular(path.join(stateDir, 'proxy.state.json'));
  // Prior installations may have only proxy.pid (and no proxy.port yet).
  // Ownership validation must still inspect those markers independently.
  const committed = committedRaw ? decodeCommittedState(committedRaw) : null;
  if (committed?.marker && processExists(committed.marker.pid)) {
    if (markerMatchesProcess(committed.marker)) throw new Error(`Proxy state belongs to a live process (${committed.marker.pid})`);
    if (processIdentity(committed.marker.pid) === null) throw new Error('Cannot verify committed proxy owner');
  }
  const raw = readRegular(path.join(stateDir, 'proxy.pid'));
  if (!raw) return;
  const marker = parseProcessMarker(raw.toString('utf8'));
  if (!marker) throw new Error('Unverifiable proxy PID marker; refusing to overwrite');
  if (processExists(marker.pid) && markerMatchesProcess(marker))
    throw new Error(`Proxy PID marker belongs to a live process (${marker.pid})`);
  // A live process with an unreadable fingerprint cannot be proven stale.
  if (processExists(marker.pid)) {
    if (processIdentity(marker.pid) === null) throw new Error('Cannot verify existing proxy PID marker');
  }
}


/** Save prior values and restore on any failed publication. The PID marker is
 * written before the atomic commit record. Readers consume the record, not
 * individually published compatibility files.
 */
export function publishStartupState(state: StartupState): StartupPublication {
  validate(state);
  fs.mkdirSync(state.stateDir, { recursive: true, mode: 0o700 });
  recoverInterruptedStartup(state.stateDir);
  assertStartupOwnership(state.stateDir);
  const old = new Map<StateFilename, Buffer | null>();
  for (const name of FILES) old.set(name, readRegular(path.join(state.stateDir, name)));
  const marker = createProcessMarker();
  const next = new Map<StateFilename, Buffer | null>([
    ['proxy.port', Buffer.from(`${state.port}\n`)],
    ['proxy.tls', state.https ? Buffer.from('1\n') : null],
    ['proxy.tld', state.tld === 'localhost' ? null : Buffer.from(`${state.tld}\n`)],
    ['proxy.pid', Buffer.from(`${JSON.stringify(marker)}\n`)],
    ['proxy.state.json', encodeCommittedState({ port: state.port, tls: state.https, tld: state.tld, marker })],
  ]);
  const modified: StateFilename[] = [];
  const before = snapshot(state.stateDir);
  const after = Object.fromEntries(next) as Record<StateFilename, Buffer | null>;
  writeStartupJournal(state.stateDir, before, after);
  const revert = () => {
    for (const name of [...modified].reverse()) {
      const filename = path.join(state.stateDir, name);
      // A competing writer should never have its state removed by rollback.
      const expected = next.get(name) ?? null;
      const current = readRegular(filename);
      if ((current === null && expected === null) || (current && expected && current.equals(expected)))
        publish(filename, old.get(name) ?? null);
    }
  };
  try {
    for (const name of FILES) {
      modified.push(name);
      publish(path.join(state.stateDir, name), next.get(name) ?? null);
    }
    clearStartupJournal(state.stateDir);
  } catch (error) {
    try { revert(); clearStartupJournal(state.stateDir); } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Proxy startup failed and state rollback was incomplete');
    }
    throw error;
  }
  let rolledBack = false;
  return { rollback() { if (!rolledBack) { rolledBack = true; revert(); } } };
}
