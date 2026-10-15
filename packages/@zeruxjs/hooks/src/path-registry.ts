import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

type PathMap = Record<string, string>;
const ALIAS = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}:[a-zA-Z0-9_./-]{1,200}$/;
function validateAlias(alias: string): void {
  if (typeof alias !== 'string' || !ALIAS.test(alias) || alias.includes('..') || alias.includes('//') || ['__proto__', 'constructor', 'prototype'].some(v => alias.split(':').includes(v))) {
    throw new Error(`[zerux] Invalid path alias: ${String(alias)}`);
  }
}

export interface PathRegistryOptions { directory?: string; file?: string }
export function createPathRegistry(options: PathRegistryOptions = {}) {
  const directory = path.resolve(options.directory ?? process.cwd());
  const filename = path.resolve(directory, options.file ?? '.zerux-paths.json');
  if (path.dirname(filename) !== directory) throw new Error('[zerux] Path registry file must be within directory');

  const read = (): PathMap => {
    let raw: string;
    try {
      const stat = fs.lstatSync(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('[zerux] Unsafe path registry');
      raw = fs.readFileSync(filename, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Object.create(null);
      throw error;
    }
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('[zerux] Invalid path registry');
    const output: PathMap = Object.create(null);
    for (const [alias, target] of Object.entries(data)) {
      validateAlias(alias);
      if (typeof target !== 'string' || !path.isAbsolute(target)) throw new Error('[zerux] Invalid registry path');
      output[alias] = target;
    }
    return output;
  };
  const write = (data: PathMap): void => {
    fs.mkdirSync(directory, { recursive: true });
    const temp = path.join(directory, `.zerux-paths-${randomBytes(8).toString('hex')}.tmp`);
    try {
      const serialized = JSON.stringify(data, null, 2) + '\n';
      if (Buffer.byteLength(serialized) > 1024 * 1024) throw new Error('[zerux] Path registry exceeds the maximum size');
      const handle = fs.openSync(temp, 'wx', 0o600);
      try { fs.writeFileSync(handle, serialized, 'utf8'); fs.fsyncSync(handle); }
      finally { fs.closeSync(handle); }
      fs.renameSync(temp, filename);
    } finally {
      try { fs.unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  };
  return {
    register(alias: string, target: string): void {
      validateAlias(alias);
      if (typeof target !== 'string' || !target.trim()) throw new Error('[zerux] Path target is empty');
      const resolved = path.resolve(directory, target);
      if (!fs.existsSync(resolved)) throw new Error(`[zerux] Target not found: ${resolved}`);
      const current = read();
      if (Object.hasOwn(current, alias) && current[alias] !== resolved) throw new Error(`[zerux] Alias already exists: ${alias}`);
      current[alias] = resolved;
      write(current);
    },
    resolve(alias: string): string | null { validateAlias(alias); return read()[alias] ?? null; },
    list(): PathMap { return { ...read() }; },
    unregister(alias: string): void {
      validateAlias(alias);
      const current = read();
      if (!Object.hasOwn(current, alias)) return;
      delete current[alias];
      write(current);
    }
  };
}
