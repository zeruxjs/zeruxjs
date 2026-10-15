import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile, lstat, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AssetManager } from './manager.js';
import type { AssetSnapshot } from './types.js';
const MAX_CATALOG_BYTES = 8 * 1024 * 1024;
async function assertRegularOrMissing(file: string): Promise<void> {
  try { if (!(await lstat(file)).isFile()) throw new Error('Catalog path is not a regular file'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
export async function saveAssetCatalog(manager: AssetManager, file: string): Promise<void> {
 const data = JSON.stringify(manager.snapshot());
 if (Buffer.byteLength(data) > MAX_CATALOG_BYTES) throw new RangeError('Asset catalog exceeds size limit');
 await mkdir(dirname(file), { recursive: true });
 await assertRegularOrMissing(file);
 const temp = `${file}.${randomUUID()}.tmp`;
 try {
   const handle = await open(temp, 'wx', 0o600);
   try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
   await assertRegularOrMissing(file);
   await rename(temp, file);
 } catch (error) { await unlink(temp).catch(() => {}); throw error; }
}
export async function loadAssetCatalog(file: string): Promise<AssetManager> {
 const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
 let snapshot: AssetSnapshot;
 try {
   const info = await handle.stat();
   if (!info.isFile() || info.size > MAX_CATALOG_BYTES) throw new Error('Invalid asset catalog file');
   snapshot = JSON.parse(await handle.readFile({ encoding: 'utf8' })) as AssetSnapshot;
 } finally { await handle.close(); }
 const catalog = new AssetManager(); catalog.load(snapshot); return catalog;
}
