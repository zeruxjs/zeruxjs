import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, readFile, writeFile, unlink, stat, readdir, open, lstat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { StoredMedia, UploadOptions, ListOptions, CleanupResult } from './types.js';
import { safePath, assertId, validateUpload } from './validation.js';

export class MediaStore {
  private readonly root: string;
  constructor(directory: string, private readonly defaultMaxBytes = 10 * 1024 * 1024) {
    if (!directory || !Number.isSafeInteger(defaultMaxBytes) || defaultMaxBytes < 1) throw new TypeError('Invalid media store configuration');
    this.root = resolve(directory);
  }
  private path(id: string): string { return safePath(this.root, id); }
  private async secureDirectory(create = false): Promise<void> {
    if (create) await mkdir(this.root, { recursive: true, mode: 0o700 });
    if ((await lstat(this.root)).isSymbolicLink()) throw new Error('Media root must not be a symbolic link');
    if (!(await stat(this.root)).isDirectory()) throw new Error('Media root must be a directory');
    // Ensure no intermediate components redirect the resolved directory elsewhere.
    if (await realpath(this.root) !== this.root) throw new Error('Media root must not contain symlink components');
  }
  private async readMetadata(id: string, includeExpired = false): Promise<StoredMedia> {
    await this.secureDirectory();
    const file = await open(this.path(id) + '.json', constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > 8192) throw new Error('Invalid media metadata file');
      const data: StoredMedia = JSON.parse(await file.readFile({ encoding: 'utf8' }));
      if (data.id !== id || typeof data.originalName !== 'string' || typeof data.contentType !== 'string' || !Number.isSafeInteger(data.size) || data.size < 0 || typeof data.createdAt !== 'string' || !/^[a-f0-9]{64}$/.test(data.sha256)) throw new Error('Corrupted media metadata');
      if (data.expiresAt && (Number.isNaN(Date.parse(data.expiresAt)) || (!includeExpired && Date.parse(data.expiresAt) <= Date.now()))) throw new Error('Media expired');
      return data;
    } finally { await file.close(); }
  }
  async upload(data: Uint8Array, options: UploadOptions): Promise<StoredMedia> {
    if (!(data instanceof Uint8Array)) throw new TypeError('Expected binary data');
    return this.uploadStream((async function* () { yield data; })(), options);
  }
  async uploadStream(source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, options: UploadOptions): Promise<StoredMedia> {
    const { max, expiresAt } = validateUpload(options, this.defaultMaxBytes);
    const id = randomUUID(); await this.secureDirectory(true);
    const dest = this.path(id); const handle = await open(dest, 'wx', 0o600);
    let bytes = 0; const hash = createHash('sha256'); let closed = false;
    try {
      for await (const chunk of source) {
        if (!(chunk instanceof Uint8Array)) throw new TypeError('Chunks must be Uint8Array');
        bytes += chunk.byteLength;
        if (!Number.isSafeInteger(bytes) || bytes > max) throw new RangeError('Media size exceeds limit');
        hash.update(chunk);
        let offset = 0;
        while (offset < chunk.byteLength) { const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset); if (!bytesWritten) throw new Error('Unable to write media'); offset += bytesWritten; }
      }
      await handle.sync(); await handle.close(); closed = true;
      const metadata: StoredMedia = { id, originalName: options.name, contentType: options.contentType, size: bytes, sha256: hash.digest('hex'), createdAt: new Date().toISOString(), ...(expiresAt ? { expiresAt } : {}) };
      await writeFile(dest + '.json', JSON.stringify(metadata), { flag: 'wx', mode: 0o600 });
      return metadata;
    } catch (error) { if (!closed) await handle.close().catch(() => {}); await unlink(dest).catch(() => {}); await unlink(dest + '.json').catch(() => {}); throw error; }
  }
  async info(id: string): Promise<StoredMedia> { assertId(id); return this.readMetadata(id); }
  async download(id: string): Promise<{ data: Buffer; metadata: StoredMedia }> {
    const metadata = await this.info(id);
    const handle = await open(this.path(id), constants.O_RDONLY | constants.O_NOFOLLOW);
    let data: Buffer;
    try { const file = await handle.stat(); if (!file.isFile() || file.size !== metadata.size) throw new Error('Media integrity size mismatch'); data = await handle.readFile(); }
    finally { await handle.close(); }
    if (data.byteLength !== metadata.size || createHash('sha256').update(data).digest('hex') !== metadata.sha256) throw new Error('Media integrity check failed');
    return { data, metadata };
  }
  async *streamRange(id: string, start = 0, end?: number): AsyncIterable<Buffer> {
    const metadata = await this.info(id);
    if (!Number.isSafeInteger(start) || start < 0 || (end !== undefined && (!Number.isSafeInteger(end) || end < start))) throw new RangeError('Invalid media range');
    const handle = await open(this.path(id), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const file = await handle.stat();
      if (!file.isFile() || file.size !== metadata.size) throw new Error('Media integrity size mismatch');
      if (start >= file.size) return;
      const last = Math.min(end ?? file.size - 1, file.size - 1);
      let offset = start;
      while (offset <= last) {
        const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, last - offset + 1));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        if (!bytesRead) throw new Error('Media changed while streaming');
        offset += bytesRead;
        yield buffer.subarray(0, bytesRead);
      }
    } finally { await handle.close(); }
  }
  async *stream(id: string): AsyncIterable<Buffer> { yield* this.streamRange(id); }
  async remove(id: string): Promise<void> {
    await this.secureDirectory();
    const path = this.path(id);
    // Never follow a replaced symlink. Unlink only entries with expected file type.
    for (const target of [path, path + '.json']) {
      try { const item = await lstat(target); if (!item.isFile()) throw new Error('Unsafe media entry'); await unlink(target); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
  async exists(id: string): Promise<boolean> { try { await this.info(id); const handle = await open(this.path(id), constants.O_RDONLY | constants.O_NOFOLLOW); try { return (await handle.stat()).isFile(); } finally { await handle.close(); } } catch { return false; } }
  async list(options: ListOptions = {}): Promise<StoredMedia[]> {
    const limit = options.limit ?? 100, offset = options.offset ?? 0;
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 10000 || !Number.isSafeInteger(offset) || offset < 0) throw new RangeError('Invalid pagination');
    try { await this.secureDirectory(); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const names = (await readdir(this.root)).filter(name => name.endsWith('.json')).sort();
    const items: StoredMedia[] = [];
    for (const name of names) {
      const id = name.slice(0, -5);
      try { const meta = await this.readMetadata(id, options.includeExpired); items.push(meta); }
      catch { /* Skip incomplete or malformed entries. */ }
    }
    return items.slice(offset, offset + limit);
  }
  async cleanupExpired(): Promise<CleanupResult> {
    let removed = 0, scanned = 0;
    try { await this.secureDirectory(); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { removed, scanned }; throw error; }
    for (const name of (await readdir(this.root)).filter(name => name.endsWith('.json'))) {
      const id = name.slice(0, -5);
      try {
        assertId(id);
        const file = await open(this.path(id) + '.json', constants.O_RDONLY | constants.O_NOFOLLOW);
        let item: StoredMedia;
        try { if ((await file.stat()).size > 8192) continue; item = JSON.parse(await file.readFile({ encoding: 'utf8' })) as StoredMedia; }
        finally { await file.close(); }
        if (item.id !== id || typeof item.expiresAt !== 'string') { scanned++; continue; }
        scanned++;
        if (!Number.isNaN(Date.parse(item.expiresAt)) && Date.parse(item.expiresAt) <= Date.now()) { await this.remove(id); removed++; }
      } catch { /* Skip malformed entries; do not remove unrelated files. */ }
    }
    return { removed, scanned };
  }
}
export const createMediaStore = (root: string, maxBytes?: number): MediaStore => new MediaStore(root, maxBytes);
