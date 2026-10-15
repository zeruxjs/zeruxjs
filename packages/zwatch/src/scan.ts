import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
export interface Entry { mtimeMs: number; size: number; }
export async function scan(root: string, ignored: (file: string) => boolean): Promise<Map<string, Entry>> {
  const entries = new Map<string, Entry>();
  const pending = [''];
  while (pending.length) {
    const relative = pending.pop()!;
    let list;
    try { list = await readdir(path.join(root, relative), { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    for (const item of list) {
      const child = path.join(relative, item.name);
      if (ignored(child)) continue;
      // Never traverse symlinks (avoid cycles and escaping the watched root).
      if (item.isDirectory()) pending.push(child);
      else if (item.isFile()) {
        try { const s = await stat(path.join(root, child)); entries.set(child, { mtimeMs: s.mtimeMs, size: s.size }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
    }
  }
  return entries;
}
export function diff(before: Map<string, Entry>, after: Map<string, Entry>) {
  const changes: {file:string;type:'new'|'update'|'delete'}[] = [];
  for (const [file, value] of after) {
    const old = before.get(file);
    if (!old) changes.push({file, type:'new'});
    else if (old.mtimeMs !== value.mtimeMs || old.size !== value.size) changes.push({file, type:'update'});
  }
  for (const file of before.keys()) if (!after.has(file)) changes.push({file,type:'delete'});
  return changes.sort((a,b)=>a.file.localeCompare(b.file));
}
