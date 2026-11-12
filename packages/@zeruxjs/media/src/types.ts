export interface StoredMedia {
  /** Opaque stored UUID, not a user/tenant identity or authorization proof. */
  id: string;
  /** Stored inert display filename; HTTP serialization applies its own encoding. */
  originalName: string;
  /** Declared bare MIME metadata, not antivirus/sniffing or decoding certification. */
  contentType: string;
  /** Observed logical byte count; not a character count. */
  size: number;
  /** SHA-256 of committed bytes; not authorship or access permission. */
  sha256: string;
  /** Stored creation-time observation; not an invented content-authorship timestamp. */
  createdAt: string;
  /** Optional stored ISO expiry; reads reject elapsed metadata. */
  expiresAt?: string;
}
export interface UploadOptions {
  /** Declared inert display name; default upload for request helper, required for direct store input. */
  name: string;
  /** Declared bare MIME metadata, not antivirus/sniffing or decoding certification. */
  contentType: string;
  /** Optional positive safe-integer lifetime in milliseconds, relative to upload validation time. */
  expiresInMs?: number;
  /** Optional positive safe-integer actual-byte ceiling; helper/store defaults remain owner-specific. */
  maxBytes?: number;
}
export interface ListOptions {
  /** Explicitly include validated expired metadata in listings; default false. */
  includeExpired?: boolean;
  /** Legacy local page size, default 100 and ceiling 10000; zero returns no items. */
  limit?: number;
  /** Nonnegative local listing offset, default zero; local implementation scans metadata before slicing. */
  offset?: number;
}
export interface CleanupResult {
  /** Count of successfully removed recognized expired records in this cleanup scan. */
  removed: number;
  /** Count of recognized metadata records examined; malformed/unreadable entries may be skipped. */
  scanned: number;
}
