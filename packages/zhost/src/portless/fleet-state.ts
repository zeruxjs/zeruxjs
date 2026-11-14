import { readStateFile } from './state-file.js';
/** Durable, private fleet checkpoint. Persist retry timestamps *before* a
 * replacement attempt to prevent a supervisor restart resetting rate limits. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import {
  ensureControlDirectory,
  validateControlName,
} from './local-control.js';
import type { FleetStatus } from './fleet-types.js';
import type { AutoscaleState } from './autoscale-policy.js';

/** Maximum serialized checkpoint size checked before reading or promotion. */
const MAX_BYTES = 65536;
export interface FleetCheckpoint {
  /** Persisted schema discriminator; only V1 is supported. */
  version: 1;
  /** Exact host-authorized control hostname bound to this record. */
  hostname: string;
  /** Deployment-settings fingerprint, not an authorization or credential token. */
  configuration: string;
  /** Wrapper process identity recorded for separately verified lifecycle operations. */
  owner: {
    /** Recorded wrapper PID; numeric PIDs alone never grant management authority. */
    pid: number;
    /** Observed OS process identity string, verified separately by lifecycle owners. */
    identity: string;
  };
  /** Last persisted fleet status, separate from live health/proxy observations. */
  status: FleetStatus;
  /** Ordered retry timestamps retained across wrapper restarts. */
  attempts: number[];
  /** Optional durable pause/cooldown metadata. */
  autoscale?: {
    /** Whether automatic scaling is explicitly paused. */
    paused: boolean;
    /** Wall-clock scale-change timestamp in milliseconds. */
    lastScaledAt: number;
  };
  /** ISO checkpoint update time, not a cross-process revision token. */
  updatedAt: string;
}
/** Validate the hostname and resolve its fixed hashed leaf inside the existing private control-directory policy.
 * @param {string} stateDir - Trusted host state root.
 * @param {string} hostname - Validated control hostname, never a caller-provided filesystem path.
 * @returns {string} Private fleet checkpoint path; not an authorization capability.
 */
export function fleetStatePath(stateDir: string, hostname: string): string {
  validateControlName(hostname);
  return path.join(
    ensureControlDirectory(stateDir),
    `${createHash('sha256')
      .update('fleet:' + hostname)
      .digest('hex')}.fleet.json`
  );
}
/** Hash explicit deployment settings to prevent silently reusing retained restart accounting under a different configuration.
 * @param {readonly string[]} command - Trusted operator command tokens, included only inside the hash input.
 * @param {readonly number[]} ports - Validated distinct private backend ports.
 * @param {number} replicas - Configured initial replica count.
 * @param {number} windowMs - Configured restart accounting window in milliseconds.
 * @param {unknown} autoscale - Optional explicit autoscaling configuration.
 * @returns {string} SHA-256 configuration identity; does not prove authorship or permission.
 */
export function fingerprintFleetConfig(
  command: readonly string[],
  ports: readonly number[],
  replicas: number,
  windowMs: number,
  autoscale?: unknown
): string {
  return createHash('sha256')
    .update(JSON.stringify({ command, ports, replicas, windowMs, autoscale }))
    .digest('hex');
}
/** Check the supported persisted identity, status/member bounds and ordered retry metadata after JSON parsing.
 * @param {unknown} value - Unknown decoded checkpoint.
 * @param {string} hostname - Expected host-authorized control hostname.
 * @returns {boolean} Whether the implemented persisted-field checks pass; no process is signaled or trusted from this alone.
 */
function validateSnapshot(
  value: unknown,
  hostname: string
): value is FleetCheckpoint {
  if (!value || typeof value !== 'object') {
    return false;
  }
  /** Partially trusted parsed candidate checked field-by-field before returning from the reader. */
  const v = value as FleetCheckpoint;
  return (
    v.version === 1 &&
    v.hostname === hostname &&
    /^[a-f0-9]{64}$/.test(v.configuration) &&
    Number.isSafeInteger(v.owner?.pid) &&
    v.owner.pid > 1 &&
    typeof v.owner.identity === 'string' &&
    v.owner.identity.length > 0 &&
    v.owner.identity.length < 256 &&
    typeof v.updatedAt === 'string' &&
    !Number.isNaN(Date.parse(v.updatedAt)) &&
    !!v.status &&
    v.status.hostname === hostname &&
    ['starting', 'running', 'degraded', 'stopping', 'stopped'].includes(
      v.status.phase
    ) &&
    Number.isSafeInteger(v.status.generation) &&
    v.status.generation >= 0 &&
    Number.isSafeInteger(v.status.desiredReplicas) &&
    v.status.desiredReplicas >= 2 &&
    v.status.desiredReplicas <= 16 &&
    Array.isArray(v.status.members) &&
    v.status.members.length <= 16 &&
    v.status.members.every(
      (m) =>
        Number.isSafeInteger(m.port) &&
        m.port > 0 &&
        m.port <= 65535 &&
        (m.pid === null || (Number.isSafeInteger(m.pid) && m.pid > 1)) &&
        typeof m.healthy === 'boolean' &&
        typeof m.routed === 'boolean'
    ) &&
    (v.autoscale === undefined ||
      (v.autoscale &&
        typeof v.autoscale.paused === 'boolean' &&
        Number.isSafeInteger(v.autoscale.lastScaledAt) &&
        v.autoscale.lastScaledAt >= 0 &&
        v.autoscale.lastScaledAt <= Date.now() + 30_000)) &&
    Array.isArray(v.attempts) &&
    v.attempts.length <= 1000 &&
    v.attempts.every(
      (n, i) =>
        Number.isSafeInteger(n) &&
        n >= 0 &&
        n <= Date.now() + 30_000 &&
        (i === 0 || v.attempts[i - 1]! <= n)
    )
  );
}
/** Read a bounded private regular inode, validate its persisted fields and retain missing state as null.
 * @param {string} stateDir - Trusted control state root.
 * @param {string} hostname - Expected validated control hostname.
 * @returns {FleetCheckpoint | null} Validated diagnostic/recovery record, or null for absence; unsafe/corrupt data throws.
 */
export function readFleetCheckpoint(
  stateDir: string,
  hostname: string
): FleetCheckpoint | null {
  try {
    /** Fixed private checkpoint leaf resolved only through the validated control-name helper. */
    const file = fleetStatePath(stateDir, hostname);
    /** Metadata and bytes from the same opened inode, avoiding a separate path inspection race. */
    const { stat: st, bytes } = readStateFile(file, MAX_BYTES);
    if (
      !st.isFile() ||
      st.isSymbolicLink() ||
      st.size > MAX_BYTES ||
      (st.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && st.uid !== process.getuid())
    ) {
      throw new Error('Unsafe fleet checkpoint');
    }
    /** Unknown parsed JSON root; never evaluated or used to load code. */
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (!validateSnapshot(value, hostname)) {
      throw new Error('Invalid fleet checkpoint');
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
/** Write a complete bounded private candidate with exclusive temporary creation, fsync and same-directory promotion.
 * @param {string} file - Fixed host-owned checkpoint path.
 * @param {FleetCheckpoint} record - Trusted typed candidate assembled by the fleet writer.
 * @returns {void} Releases owned descriptors/temporary files; directory fsync is best-effort on unsupported filesystems.
 */
function writeCheckpoint(file: string, record: FleetCheckpoint): void {
  /** Complete serialized trusted candidate, bounded before acquiring a temporary file. */
  const payload = JSON.stringify(record) + '\n';
  if (Buffer.byteLength(payload) > MAX_BYTES) {
    throw new Error('Fleet checkpoint exceeds size limit');
  }
  /** Unpredictable exclusive same-directory temporary file, removed on success or failure. */
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    /** Owned file/directory descriptor, closed in finally after write/fsync. */
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, payload);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      if (fs.lstatSync(file).isSymbolicLink()) {
        throw new Error('Unsafe fleet checkpoint symlink');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    fs.renameSync(temporary, file);
    try {
      /** Owned file/directory descriptor, closed in finally after write/fsync. */
      const fd = fs.openSync(path.dirname(file), 'r', 0o600);
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      /* unsupported filesystems */
    }
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // eslint-disable-next-line no-unsafe-finally -- Preserve the existing policy of surfacing private temporary-file cleanup failures.
        throw error;
      }
    }
  }
}
/** Bind synchronous durable accounting callbacks to one configuration, refusing a retained checkpoint with a different fingerprint.
 * @param {string} stateDir - Trusted private control state root.
 * @param {string} hostname - Host-authorized fleet hostname.
 * @param {string} configuration - Validated SHA-256 deployment fingerprint.
 * @param {string} identity - Verified current wrapper process identity, not an untrusted role claim.
 * @returns {object} Restored snapshots and update/attempt/autoscale callbacks; no persistent descriptors or timers are acquired.
 */
export function createFleetCheckpointWriter(
  stateDir: string,
  hostname: string,
  configuration: string,
  identity: string
) {
  if (!/^[a-f0-9]{64}$/.test(configuration) || !identity) {
    throw new Error('Invalid fleet checkpoint owner/configuration');
  }
  ensureControlDirectory(stateDir, true);
  /** Fixed private checkpoint leaf resolved only through the validated control-name helper. */
  const file = fleetStatePath(stateDir, hostname);
  /** Retained checkpoint whose configuration must match before restoring accounting. */
  const previous = readFleetCheckpoint(stateDir, hostname);
  if (previous && previous.configuration !== configuration) {
    throw new Error(
      'Fleet configuration differs from retained restart budget; inspect checkpoint before changing deployment'
    );
  }
  let status: FleetStatus | undefined;
  let attempts = previous?.attempts ?? [];
  let autoscale = previous?.autoscale;
  /** Write current typed writer state only after an initial status has been supplied.
   * @returns {void} Propagates persistence failure; no queue or automatic replay is used.
   */
  const save = () => {
    if (!status) {
      return;
    }
    writeCheckpoint(file, {
      version: 1,
      hostname,
      configuration,
      owner: { pid: process.pid, identity },
      status,
      attempts: [...attempts],
      autoscale,
      updatedAt: new Date().toISOString(),
    });
  };
  return {
    restoredAttempts: [...attempts] as readonly number[],
    restoredReplicas: previous?.status.desiredReplicas,
    restoredAutoscale: autoscale ? { ...autoscale } : undefined,
    /** Checkpoint pause/cooldown state and restore its prior in-memory value if persistence fails.
     * @param {Pick<AutoscaleState, 'paused' | 'lastScaledAt'>} next - Trusted controller autoscale pause and last-scale timestamp.
     * @returns {void} Persists synchronously or throws without retaining the candidate autoscale value.
     */
    setAutoscale(next: Pick<AutoscaleState, 'paused' | 'lastScaledAt'>) {
      /** Previous autoscale value retained for compensation if its checkpoint fails. */
      const prior = autoscale;
      autoscale = { paused: next.paused, lastScaledAt: next.lastScaledAt };
      try {
        save();
      } catch (error) {
        autoscale = prior;
        throw error;
      }
    },
    /** Clone the latest fleet status into writer state, then synchronously attempt persistence.
     * @param {Readonly<FleetStatus>} next - Trusted current controller snapshot.
     * @returns {void} Propagates write failure; this method does not roll back the already replaced in-memory status.
     */
    update(next: Readonly<FleetStatus>) {
      status = structuredClone(next);
      save();
    },
    /** Checkpoint restart timestamps before a replacement spawn, restoring prior in-memory accounting on persistence failure.
     * @param {readonly number[]} next - Ordered attempt timestamps validated by the owning restart-budget policy.
     * @returns {void} Caller must not spawn after this callback throws.
     */
    attempt(next: readonly number[]) {
      /** Previous accounting array retained until the candidate attempt checkpoint succeeds. */
      const previousAttempts = attempts;
      attempts = [...next];
      try {
        save();
      } catch (error) {
        attempts = previousAttempts;
        throw error;
      }
    },
    get snapshot() {
      return readFleetCheckpoint(stateDir, hostname);
    },
  };
}

/** Remove an offline checkpoint only under the host’s operation lock and after verifying no controller/generation owns it.
 * @param {string} stateDir - Trusted private control state root whose operation lock the caller holds.
 * @param {string} hostname - Host-authorized offline fleet hostname.
 * @returns {boolean} False when absent, true after removal; stat/re-read checks are not an atomic compare-and-delete primitive.
 */
export function removeFleetCheckpoint(
  stateDir: string,
  hostname: string
): boolean {
  /** Fixed private checkpoint leaf resolved only through the validated control-name helper. */
  const file = fleetStatePath(stateDir, hostname);
  /** Offline checkpoint candidate read under the required host operation lock. */
  const current = readFleetCheckpoint(stateDir, hostname);
  if (!current) {
    return false;
  }
  /** Observed inode metadata before confirming the checkpoint has not been replaced. */
  const before = fs.lstatSync(file);
  // Do not unlink a replacement checkpoint written after our read.
  /** Second inode observation; the operation lock still owns the read/unlink race boundary. */
  const after = fs.lstatSync(file);
  if (
    before.ino !== after.ino ||
    before.dev !== after.dev ||
    JSON.stringify(readFleetCheckpoint(stateDir, hostname)) !==
      JSON.stringify(current)
  ) {
    throw new Error('Fleet checkpoint changed during reset');
  }
  fs.unlinkSync(file);
  return true;
}
