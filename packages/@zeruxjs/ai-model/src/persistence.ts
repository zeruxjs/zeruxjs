import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, unlink, lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DocumentKnowledgeBase } from './knowledge-base.js';
import type { KnowledgeOptions, KnowledgeSnapshot } from './types.js';
const LIMIT = 32 * 1024 * 1024;
async function checkTarget(file: string) {
  try { if (!(await lstat(file)).isFile()) throw new TypeError('Unsafe knowledge snapshot path'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
export async function saveKnowledgeBase(base: DocumentKnowledgeBase, file: string): Promise<void> {
  const content = JSON.stringify(base.snapshot());
  if (Buffer.byteLength(content) > LIMIT) throw new RangeError('Knowledge snapshot too large');
  await mkdir(dirname(file), {recursive:true}); await checkTarget(file);
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temp,'wx',0o600);
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    await checkTarget(file);
    await rename(temp,file);
  } catch (error) { await unlink(temp).catch(() => {}); throw error; }
}
export async function loadKnowledgeBase(file: string, options?: KnowledgeOptions): Promise<DocumentKnowledgeBase> {
  const handle = await open(file,constants.O_RDONLY | constants.O_NOFOLLOW);
  let snapshot: KnowledgeSnapshot;
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > LIMIT) throw new TypeError('Invalid knowledge snapshot file'); snapshot = JSON.parse(await handle.readFile({encoding:'utf8'})) as KnowledgeSnapshot; }
  finally { await handle.close(); }
  const base = new DocumentKnowledgeBase(options);
  base.restore(snapshot);
  return base;
}
