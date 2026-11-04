import type {FileAddress, FileInfo, PutFileOptions, FileSource, StorageManager} from './types.js';
export interface UploadIdentity { tenant: string; subject: string }
export interface UploadPart { number: number; size: number; sha256: string; etag?: string }
export interface UploadSession { id: string; expiresAt: number; size: number; sha256: string; status: 'open'|'finalizing'|'complete'|'aborted'|'initiating'; parts: UploadPart[] }
/** Trusted driver boundary. Never expose native IDs directly as an HTTP authorization mechanism. */
export interface NativeMultipartOperations {
  readonly minPartBytes: number;
  readonly createOnly: boolean;
  initiate(address: FileAddress, options: PutFileOptions): Promise<string>;
  upload(address: FileAddress, id: string, part: UploadPart, bytes: Uint8Array, signal?: AbortSignal): Promise<string>;
  list(address: FileAddress, id: string, maxParts: number): Promise<UploadPart[]>;
  complete(address: FileAddress, id: string, parts: UploadPart[], createOnly: boolean, signal?:AbortSignal): Promise<void>;
  abort(address: FileAddress, id: string): Promise<void>;
}
export interface ResumableUploadOptions {
  files: StorageManager;
  /** Private canonical local journal/staging root, shared by resumptions using this manager configuration. */
  root: string;
  authorize: (identity: UploadIdentity, address: FileAddress, action: 'initiate'|'part'|'list'|'finalize'|'abort') => boolean | Promise<boolean>;
  maxBytes?: number; maxPartBytes?: number; maxParts?: number; maxSessions?: number; maxPending?: number; ttlMs?: number;
  /** Trusted clock for deterministic tests. */
  now?: () => number;
  /** Explicit approval is needed again for each cleanup batch; never inferred from request headers. */
  approveCleanup?: (candidates: readonly UploadCleanupCandidate[]) => boolean | Promise<boolean>;
}
export interface UploadCleanupCandidate { id: string; expiresAt: number; status: UploadSession['status']; revision: string }
export interface ResumableUploads {
  initiate(identity: UploadIdentity, address: FileAddress, options: PutFileOptions & {size:number; sha256:string}): Promise<UploadSession>;
  uploadPart(identity: UploadIdentity, id: string, number: number, source: FileSource, options: {size:number; sha256:string; signal?:AbortSignal}): Promise<UploadPart>;
  listParts(identity: UploadIdentity, id: string): Promise<UploadSession>;
  finalize(identity: UploadIdentity, id: string, partNumbers: readonly number[], signal?:AbortSignal): Promise<FileInfo>;
  abort(identity: UploadIdentity, id: string): Promise<void>;
  previewCleanup(options?:{cursor?:string;limit?:number}): Promise<{items:UploadCleanupCandidate[];nextCursor?:string}>;
  cleanup(candidates: readonly UploadCleanupCandidate[]): Promise<number>;
  /** Drains calls but keeps unfinished sessions for resumption; does not close the borrowed file manager. */
  close(): Promise<void>;
}
