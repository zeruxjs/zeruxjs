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
  const st = unsafeFile(filePath);
  if (!st) return fallback;
  if (st.size > MAX_STATE_BYTES) throw new Error('Devtools state file exceeds 4 MiB');
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const content = fs.readFileSync(fd, { encoding: 'utf8' });
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
  } finally { try { fs.unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
};
