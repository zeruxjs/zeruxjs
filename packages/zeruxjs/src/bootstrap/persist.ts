import {readLocalFileSync} from '../utils/file-content.js';
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
  try{return JSON.parse(readLocalFileSync(file,MAX_BYTES).toString('utf8')) as T;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return fallback;throw error;}
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
  // eslint-disable-next-line no-unsafe-finally -- Cleanup failures intentionally propagate so private temporary-file cleanup failures are visible.
  } finally { try { fs.unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
}
