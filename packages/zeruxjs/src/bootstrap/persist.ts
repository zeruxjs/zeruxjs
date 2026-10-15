import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const MAX_BYTES = 4 * 1024 * 1024;
const inspect = (file: string) => {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink()) throw new Error(`Unsafe Zerux runtime state file: ${file}`);
    if (st.size > MAX_BYTES) throw new Error('Zerux runtime state exceeds 4 MiB');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
};

/** Load optional runtime metadata without following symlinks or unbounded reads. */
export function readRuntimeJson<T>(file: string, fallback: T): T {
  if (!inspect(file)) return fallback;
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const value = fs.readFileSync(fd, 'utf8');
    if (Buffer.byteLength(value) > MAX_BYTES) throw new Error('Zerux runtime state exceeds 4 MiB');
    return JSON.parse(value) as T;
  } finally { fs.closeSync(fd); }
}

/** Replace a complete runtime manifest in one rename; deny linked or huge files. */
export function writeRuntimeJson(file: string, value: unknown): void {
  const data = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(data) > MAX_BYTES) throw new Error('Zerux runtime state exceeds 4 MiB');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  inspect(file);
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temp, data, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    inspect(file);
    fs.renameSync(temp, file);
  } finally { try { fs.unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
}
