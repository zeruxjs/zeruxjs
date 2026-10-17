/** Stable, serializable state for a managed application's lifecycle. */
import type { ProcessExit } from './process-supervisor.js';

export type ManagedPhase = 'starting' | 'running' | 'restarting' | 'stopping' | 'stopped';
export interface ManagedExitInfo {
    code: number | null;
    signal: string | null;
    error?: string;
}
export interface ManagedStatus {
    readonly phase: ManagedPhase;
    readonly pid: number | null;
    /** Increases whenever a new child has successfully passed readiness. */
    readonly generation: number;
    /** Counts automatic restarts attempted, not manual reloads. */
    readonly automaticRestarts: number;
    readonly lastExit: ManagedExitInfo | null;
    readonly updatedAt: string;
}

export function serializeExit(result: ProcessExit): ManagedExitInfo {
    return {
        code: result.code,
        signal: result.signal,
        ...(result.error ? { error: result.error.message.slice(0, 512) } : {}),
    };
}

export type StatusListener = (status: Readonly<ManagedStatus>) => void;
