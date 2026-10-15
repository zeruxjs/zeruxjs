/** Storage-neutral binary objects; bucket and key are separate from the connection name. */
export interface FileAddress { storage?: string; bucket: string; key: string }
export type FileVisibility = 'private' | 'public';
export interface FileInfo extends FileAddress {
  size: number; etag: string; contentType: string; modifiedAt: string;
  visibility: FileVisibility; cacheControl?: string; contentDisposition?: string;
  metadata: Record<string, string>; versionId?: string; expiresAt?: string;
  encryption?: string;
  /** Whether byte ranges are meaningful after storage-side decryption. */
  rangeSupported?: boolean;
}
export type FileSource = Uint8Array | AsyncIterable<Uint8Array> | Iterable<Uint8Array> | ReadableStream<Uint8Array>;
export interface PutFileOptions {
  contentType?: string; contentDisposition?: string; visibility?: FileVisibility;
  cacheControl?: string; metadata?: Record<string,string>; maxBytes?: number;
  /** Fail rather than overwrite an existing object. Defaults to true. */
  ifNoneMatch?: boolean; expiresAt?: string; signal?: AbortSignal;
}
export interface ReadFileOptions { start?: number; end?: number; signal?: AbortSignal }
export interface ListFileOptions { prefix?: string; limit?: number; cursor?: string }
export interface FileListing { items: FileInfo[]; nextCursor?: string }
export interface StorageDriver {
  readonly kind: string;
  put(address: FileAddress, data: FileSource, options?: PutFileOptions): Promise<FileInfo>;
  stat(address: FileAddress): Promise<FileInfo | null>;
  read(address: FileAddress, options?: ReadFileOptions): Promise<AsyncIterable<Uint8Array>>;
  delete(address: FileAddress): Promise<boolean>;
  list(bucket: string, options?: ListFileOptions): Promise<FileListing>;
  copy?(from: FileAddress, to: FileAddress, options?: PutFileOptions): Promise<FileInfo>;
  signedUrl?(method: 'GET' | 'PUT', address: FileAddress, expiresSeconds: number, options?: PutFileOptions): Promise<string>;
  publicUrl?(address: FileAddress): string | undefined;
  close?(): Promise<void>;
}
export interface StorageDefinition { name: string; driver: StorageDriver; readonly?: boolean; allowedTypes?: string[]; allowedBuckets?: string[]; keyPrefix?: string; maxBytes?: number }
export interface StorageManagerOptions { stores: StorageDefinition[]; defaultStorage?: string; cache?: { maxEntries?: number; maxBytes?: number; ttlMs?: number } }
export interface StorageManager {
  put(address: FileAddress, data: FileSource, options?: PutFileOptions): Promise<FileInfo>;
  stat(address: FileAddress): Promise<FileInfo | null>;
  read(address: FileAddress, options?: ReadFileOptions): Promise<AsyncIterable<Uint8Array>>;
  get(address: FileAddress, maxBytes?: number): Promise<Uint8Array>;
  exists(address: FileAddress): Promise<boolean>;
  setVisibility(address: FileAddress, visibility: FileVisibility): Promise<FileInfo>;
  move(from: FileAddress, to: FileAddress, options?: PutFileOptions): Promise<FileInfo>;
  delete(address: FileAddress): Promise<boolean>;
  list(bucket: string, options?: ListFileOptions & { storage?: string }): Promise<FileListing>;
  copy(from: FileAddress, to: FileAddress, options?: PutFileOptions): Promise<FileInfo>;
  signedUrl(method: 'GET' | 'PUT', address: FileAddress, expiresSeconds: number, options?: PutFileOptions): Promise<string>;
  publicUrl(address: FileAddress): string | undefined;
  getDriver(storage?: string): StorageDriver;
  cacheStats(): { entries: number; bytes: number; hits: number; misses: number };
  invalidate(address?: FileAddress): void;
  close(): Promise<void>;
}
