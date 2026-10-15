export interface StoredMedia { id: string; originalName: string; contentType: string; size: number; sha256: string; createdAt: string; expiresAt?: string }
export interface UploadOptions { name: string; contentType: string; expiresInMs?: number; maxBytes?: number }
export interface ListOptions { includeExpired?: boolean; limit?: number; offset?: number }
export interface CleanupResult { removed: number; scanned: number }
