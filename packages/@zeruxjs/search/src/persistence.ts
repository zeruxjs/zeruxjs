import { constants } from 'node:fs';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { SearchDocument } from './types.js';
import { SearchIndex } from './search-index.js';

export interface SearchPersistenceOptions { maxBytes?: number }
function maxBytes(options?: SearchPersistenceOptions): number {
  const value = options?.maxBytes ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(value) || value < 256 || value > 256 * 1024 * 1024) throw new RangeError('Invalid snapshot byte limit');
  return value;
}
async function validatedPath(filename: string): Promise<string> {
  if (typeof filename !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(basename(filename)) || basename(filename).startsWith('.')) throw new TypeError('Invalid snapshot filename');
  const pathname=resolve(filename), dir=dirname(pathname);
  if (await realpath(dir) !== dir) throw new Error('Snapshot directory must not contain symlinks');
  return pathname;
}
async function rejectSymlink(file:string):Promise<void> {
  try {if ((await lstat(file)).isSymbolicLink()) throw new Error('Snapshot path cannot be a symlink');}
  catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
}
/** Atomic, size-bounded single-process snapshot persistence; keep the directory private. */
export async function saveSearchSnapshot<T extends SearchDocument>(filename:string,index:SearchIndex<T>,options?:SearchPersistenceOptions):Promise<void> {
  const file=await validatedPath(filename), bytes=Buffer.from(JSON.stringify(index.snapshot()));
  if(bytes.length>maxBytes(options))throw new RangeError('Search snapshot too large');
  await rejectSymlink(file);
  const temporary=`${file}.${randomBytes(8).toString('hex')}.tmp`;
  let handle:Awaited<ReturnType<typeof open>>|undefined;
  try {
    handle=await open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();handle=undefined;
    await rejectSymlink(file);
    await rename(temporary,file);
    // Flush the directory entry on platforms that support directory fsync.
    try {const d=await open(dirname(file),'r');try{await d.sync();}finally{await d.close();}}catch{/* best effort on platforms without directory fsync */}
  } finally {await handle?.close();await unlink(temporary).catch(error=>{if(error?.code!=='ENOENT')throw error});}
}
/** Restores atomically: a malformed or oversized snapshot never clears the current index. */
export async function loadSearchSnapshot<T extends SearchDocument>(filename:string,index:SearchIndex<T>,options?:SearchPersistenceOptions):Promise<boolean> {
  const file=await validatedPath(filename);
  await rejectSymlink(file);
  let handle:Awaited<ReturnType<typeof open>>;
  try {handle=await open(file,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
  try {
    const stat=await handle.stat();
    if(!stat.isFile() || stat.size>maxBytes(options))throw new RangeError('Invalid snapshot file size');
    const content=await handle.readFile({encoding:'utf8'});
    index.load(JSON.parse(content));
    return true;
  } finally {await handle.close();}
}
