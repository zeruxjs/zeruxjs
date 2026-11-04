import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const MAX_STATE_BYTES = 4 * 1024 * 1024;
const unsafeFile = (filePath: string) => {
  try {
    const st = fs.lstatSync(filePath);
    if (!st.isFile() || st.isSymbolicLink()) throw new Error(`Unsafe devtools state file: ${filePath}`);
    return st;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
};

export const ensureParentDirectory = (filePath: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
};

/** Optional missing files are allowed; corrupt, oversized or linked files fail closed. */
export const readJsonFile = <T>(filePath: string, fallback: T): T => {
  let fd: number;
  try { fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw new Error('Unsafe devtools state file', {cause:error}); throw error; }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > MAX_STATE_BYTES) throw new Error('Invalid devtools state file');
    const bytes = Buffer.alloc(st.size + 1), size = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (size > st.size) throw new Error('Devtools state changed during read');
    const content = bytes.subarray(0, size).toString('utf8');
    if (Buffer.byteLength(content) > MAX_STATE_BYTES) throw new Error('Devtools state file exceeds 4 MiB');
    return JSON.parse(content) as T;
  } finally { fs.closeSync(fd); }
};

/** Private, atomic replacement. Never follow an existing symlink at the destination. */
export const writeJsonFile = (filePath: string, value: unknown): void => {
  const payload = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(payload) > MAX_STATE_BYTES) throw new Error('Devtools state file exceeds 4 MiB');
  ensureParentDirectory(filePath);
  unsafeFile(filePath);
  const temp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temp, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.chmodSync(temp, 0o600);
    // Close the gap where another process might replace the target with a link.
    unsafeFile(filePath);
    fs.renameSync(temp, filePath);
  // eslint-disable-next-line no-unsafe-finally -- Cleanup failures intentionally propagate so private temporary-file cleanup failures are visible.
  } finally { try { fs.unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
};
