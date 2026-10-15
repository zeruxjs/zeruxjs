/** Read-only runtime observability: private, atomic status snapshots per wrapper.
 * This is diagnostic state only. Never use it to authorize process signaling. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { processIdentity } from './lifecycle.js';
import type { ManagedStatus } from './managed-status.js';

export interface RuntimeStatusRecord {
    version: 1;
    hostname: string;
    ownerPid: number;
    ownerIdentity: string | null;
    status: ManagedStatus;
}
export interface InspectedRuntime extends RuntimeStatusRecord {
    /** Verified process identity and a nonterminal snapshot. Not a health check. */
    alive: boolean;
}
const MAX_BYTES = 8192;
const MAX_RECORDS = 200;
const hostnameValid = (name: string) => /^[a-z0-9][a-z0-9._-]{0,240}$/.test(name) && !name.includes('..');

function runtimeDir(stateDir: string): string {
    const userId = typeof process.getuid === 'function' ? String(process.getuid()) : 'user';
    return path.join(stateDir, `app-status-${userId}`);
}
function safeDirectory(dir: string, create: boolean): boolean {
    if (create) fs.mkdirSync(dir, { mode: 0o700, recursive: true });
    let stats: fs.Stats;
    try { stats = fs.lstatSync(dir); }
    catch (error) {
        if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('Unsafe application status directory');
    // A shared proxy state directory is permitted; the per-user child isn't.
    if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) throw new Error('Application status directory belongs to another user');
    return true;
}
function writeAtomically(filename: string, value: string): void {
    const temporary = `${filename}.${randomBytes(8).toString('hex')}.tmp`;
    let fd: number | undefined;
    try {
        fd = fs.openSync(temporary, 'wx', 0o600);
        fs.writeFileSync(fd, value);
        fs.fsyncSync(fd);
        fs.closeSync(fd); fd = undefined;
        // Refuse to overwrite a symlink, even though rename itself doesn't follow it.
        try { if (fs.lstatSync(filename).isSymbolicLink()) throw new Error('Unsafe status file'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        fs.renameSync(temporary, filename);
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
        try { fs.unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
}

/** Creates a new process-scoped status writer. Never stores argv or environment secrets. */
export function createRuntimeStatusWriter(stateDir: string, hostname: string): (status: ManagedStatus) => void {
    if (!hostnameValid(hostname)) throw new TypeError('Invalid application status hostname');
    const dir = runtimeDir(stateDir);
    safeDirectory(stateDir, false); // don't create the proxy state directory here
    safeDirectory(dir, true);
    const nameHash = createHash('sha256').update(hostname).digest('hex').slice(0, 16);
    const filename = path.join(dir, `${nameHash}-${process.pid}-${randomBytes(8).toString('hex')}.json`);
    const ownerIdentity = processIdentity(process.pid);
    return status => {
        const record: RuntimeStatusRecord = { version: 1, hostname, ownerPid: process.pid, ownerIdentity, status };
        const raw = JSON.stringify(record) + '\n';
        if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error('Application status record too large');
        writeAtomically(filename, raw);
    };
}

function parseRecord(raw: string): RuntimeStatusRecord | null {
    try {
        const value: unknown = JSON.parse(raw);
        if (typeof value !== 'object' || value === null) return null;
        const data = value as Partial<RuntimeStatusRecord>;
        const state = data.status;
        if (data.version !== 1 || typeof data.hostname !== 'string' || !hostnameValid(data.hostname) ||
            !Number.isSafeInteger(data.ownerPid) || (data.ownerPid ?? 0) <= 1 ||
            !(data.ownerIdentity === null || (typeof data.ownerIdentity === 'string' && data.ownerIdentity.length <= 128)) ||
            !state || !['starting', 'running', 'restarting', 'stopping', 'stopped'].includes(state.phase) ||
            !(state.pid === null || Number.isSafeInteger(state.pid)) ||
            !Number.isSafeInteger(state.generation) || !Number.isSafeInteger(state.automaticRestarts) ||
            typeof state.updatedAt !== 'string' || !Number.isFinite(Date.parse(state.updatedAt))) return null;
        return data as RuntimeStatusRecord;
    } catch { return null; }
}

/** Returns validated records. Malformed/symlinked snapshots are ignored, never executed. */
export function listRuntimeStatus(stateDir: string, hostname?: string): InspectedRuntime[] {
    if (hostname !== undefined && !hostnameValid(hostname)) throw new TypeError('Invalid application status hostname');
    const dir = runtimeDir(stateDir);
    if (!safeDirectory(dir, false)) return [];
    const result: InspectedRuntime[] = [];
    // Cap filesystem work and memory, and ignore non-JSON/nonregular files.
    const files = fs.readdirSync(dir).filter(name => /^[a-f0-9]{16}-\d+-[a-f0-9]{16}\.json$/.test(name)).slice(0, MAX_RECORDS);
    for (const file of files) {
        const filename = path.join(dir, file);
        try {
            const stats = fs.lstatSync(filename);
            if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_BYTES) continue;
            const record = parseRecord(fs.readFileSync(filename, 'utf8'));
            if (!record || (hostname && record.hostname !== hostname)) continue;
            result.push({ ...record, alive: record.status.phase !== 'stopped' &&
                record.ownerIdentity !== null && processIdentity(record.ownerPid) === record.ownerIdentity });
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') continue; }
    }
    return result.sort((a, b) => b.status.updatedAt.localeCompare(a.status.updatedAt));
}
