import type { StoredMedia } from './types.js';
import type { MediaStore } from './store.js';
import { mediaRequestBody } from './request-body.js';
export interface MediaRequestUploadOptions {
  /** Declared inert display name; default upload for request helper, required for direct store input. */
  name?: string;
  /** Optional positive safe-integer actual-byte ceiling; helper/store defaults remain owner-specific. */
  maxBytes?: number;
  /** Optional positive safe-integer lifetime in milliseconds, relative to upload validation time. */
  expiresInMs?: number;
}
/** Stream a raw host-authorized request into a borrowed legacy store, cancelling unused/failed request bodies on rejection.
 * @param {MediaStore} store - Borrowed private disk store; no close handle is acquired here.
 * @param {Request} request - Host-authorized POST/PUT binary request, not multipart parsing.
 * @param {MediaRequestUploadOptions} options - Optional display name (default upload), byte ceiling and lifetime.
 * @returns {Promise<StoredMedia>} Committed storage metadata; prior authorization and MIME/content policy remain host responsibilities.
 */
export async function uploadMediaRequest(
  store: MediaStore,
  request: Request,
  options: MediaRequestUploadOptions = {}
): Promise<StoredMedia> {
  try {
    /** Validated MIME/lazy source; downstream rejection before iteration acquires no reader. */
    const body = mediaRequestBody(request, options);
    return await store.uploadStream(body.source, {
      name: options.name ?? 'upload',
      contentType: body.contentType,
      maxBytes: options.maxBytes,
      expiresInMs: options.expiresInMs,
    });
  } catch (error) {
    await request.body?.cancel().catch(() => {});
    throw error;
  }
}
