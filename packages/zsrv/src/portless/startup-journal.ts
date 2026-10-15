/** Crash-recoverable journal for the four proxy startup metadata files.
 * Callers must hold the proxy operation lock throughout recovery/publication.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

export const STATE_NAMES = ['proxy.port', 'proxy.tls', 'proxy.tld', 'proxy.pid', 'proxy.state.json'] as const;
export type StateName = typeof STATE_NAMES[number];
export type Snapshot = Record<StateName, Buffer | null>;
const JOURNAL = '.proxy-startup-journal.json';
const MAX_FILE = 64 * 1024;

export function regularFile(file: string, limit = MAX_FILE): Buffer | null {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit)
      throw new Error(`Unsafe proxy state file: ${file}`);
    return fs.readFileSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function syncDirectory(dir: string): void {
  // Not all platforms permit directory fsync. File fsync/rename still applies.
  try { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
  catch (error) { if (!['EINVAL', 'EISDIR', 'EBADF', 'EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
}

export function atomicStateWrite(file: string, bytes: Buffer | null): void {
  const dir = path.dirname(file);
  if (bytes === null) {
    try { fs.unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    syncDirectory(dir);
    return;
  }
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`);
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
    syncDirectory(dir);
  } finally {
    try { fs.unlinkSync(tmp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}

export function snapshot(dir: string): Snapshot {
  return Object.fromEntries(STATE_NAMES.map(name => [name, regularFile(path.join(dir, name))])) as Snapshot;
}

function encode(state: Snapshot): Record<StateName, string | null> {
  return Object.fromEntries(STATE_NAMES.map(name => [name, state[name]?.toString('base64') ?? null])) as Record<StateName, string | null>;
}
function decode(value: unknown): Snapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid proxy startup journal');
  const data = value as Record<string, unknown>;
  return Object.fromEntries(STATE_NAMES.map(name => {
    const bytes = data[name];
    // Version-1 journals created before the committed-state record existed
    // contain only the four legacy keys. Treat the new key as absent.
    if (name === 'proxy.state.json' && bytes === undefined) return [name, null];
    if (bytes === null) return [name, null];
    if (typeof bytes !== 'string' || bytes.length > MAX_FILE * 2 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(bytes))
      throw new Error('Invalid proxy startup journal payload');
    const decoded = Buffer.from(bytes, 'base64');
    if (decoded.length > MAX_FILE || decoded.toString('base64') !== bytes) throw new Error('Invalid proxy startup journal payload');
    return [name, decoded];
  })) as Snapshot;
}
export function equalState(a: Buffer | null, b: Buffer | null): boolean {
  return a === null ? b === null : b !== null && a.equals(b);
}
export function journalPath(dir: string): string { return path.join(dir, JOURNAL); }

export function writeStartupJournal(dir: string, before: Snapshot, after: Snapshot): void {
  if (regularFile(journalPath(dir), MAX_FILE * 16) !== null) throw new Error('Unrecovered proxy startup journal exists');
  atomicStateWrite(journalPath(dir), Buffer.from(JSON.stringify({ version: 1, before: encode(before), after: encode(after) })));
}
export function clearStartupJournal(dir: string): void { atomicStateWrite(journalPath(dir), null); }

/** Recover an interrupted publication without overwriting unexpected external edits.
 * A live marker is never removed, even if it matches the journal's planned values.
 */
export function recoverStartupJournal(dir: string, isLiveMarker: (raw: string) => boolean): boolean {
  const raw = regularFile(journalPath(dir), MAX_FILE * 16);
  if (raw === null) return false;
  let record: { before: Snapshot; after: Snapshot };
  try {
    const data = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
    if (data.version !== 1) throw new Error('Unknown proxy journal version');
    record = { before: decode(data.before), after: decode(data.after) };
  } catch { throw new Error('Invalid proxy startup journal; manual recovery required'); }
  const current = snapshot(dir);
  for (const name of STATE_NAMES) {
    if (!equalState(current[name], record.before[name]) && !equalState(current[name], record.after[name]))
      throw new Error(`Proxy state changed outside interrupted startup (${name}); manual recovery required`);
  }
  if (current['proxy.pid'] !== null && isLiveMarker(current['proxy.pid'].toString('utf8')))
    throw new Error('Cannot recover proxy startup journal while recorded process is live');
  // The canonical owner record must be protected independently: a legacy PID
  // file might have been manually deleted while a live committed owner remains.
  if (current['proxy.state.json'] !== null) {
    let marker: unknown;
    try { marker = (JSON.parse(current['proxy.state.json'].toString('utf8')) as Record<string, unknown>).marker; }
    catch { throw new Error('Invalid committed proxy state; manual recovery required'); }
    if (!marker || isLiveMarker(JSON.stringify(marker)))
      throw new Error('Cannot recover proxy startup journal while committed process is live or unverifiable');
  }
  // Restore the owner marker first; readers must not mistake the new metadata for committed state.
  for (const name of [...STATE_NAMES].reverse()) {
    if (!equalState(current[name], record.before[name])) atomicStateWrite(path.join(dir, name), record.before[name]);
  }
  clearStartupJournal(dir);
  return true;
}
