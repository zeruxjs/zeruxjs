/** Stable, serializable state for a managed application's lifecycle. */
import type { ProcessExit } from './process-supervisor.js';

export type ManagedPhase =
  | 'starting'
  | 'running'
  | 'restarting'
  | 'stopping'
  | 'stopped';
export interface ManagedExitInfo {
  /** Native numeric exit code, or null for a signal/spawn failure. */
  code: number | null;
  /** Observed terminating signal when present. */
  signal: string | null;
  /** Bounded internal cause summary; may require host redaction before UI/log publication. */
  error?: string;
}
export interface ManagedStatus {
  /** Manager lifecycle phase, independent of instantaneous child readiness. */
  readonly phase: ManagedPhase;
  /** Current owned child PID, or null between/after generations. */
  readonly pid: number | null;
  /** Increases whenever a new child has successfully passed readiness. */
  readonly generation: number;
  /** Counts automatic restarts attempted, not manual reloads. */
  readonly automaticRestarts: number;
  /** Most recent bounded internal exit summary, or null before any exit. */
  readonly lastExit: ManagedExitInfo | null;
  /** Wall-clock ISO snapshot time; not a durable history sequence. */
  readonly updatedAt: string;
}

/** Copy bounded internal exit metadata without stacks; hosts must still redact sensitive native error messages before public exposure.
 * @param {ProcessExit} result - Private native child outcome.
 * @returns {ManagedExitInfo} Code/signal and at most 512 message characters; not an automatic secret-redaction guarantee.
 */
export function serializeExit(result: ProcessExit): ManagedExitInfo {
  return {
    code: result.code,
    signal: result.signal,
    ...(result.error ? { error: result.error.message.slice(0, 512) } : {}),
  };
}

export type StatusListener = (status: Readonly<ManagedStatus>) => void;
