import { randomUUID } from 'node:crypto';
import { createFileResponse, uploadFileRequest } from '@zeruxjs/files';
import type { StorageManager, FileInfo, FileAddress } from '@zeruxjs/files';

export interface MediaFilesOptions {
  /** Optional registered storage name; manager default is used when absent. */
  storage?: string;
  /** Explicit host-selected bucket; request input must not override tenant scope. */
  bucket: string;
  /** Files are stored as <prefix>/<random UUID>. No user-provided path is trusted. */
  prefix?: string;
  /** Service upload ceiling, default 16 MiB; per-upload options can only lower it. */
  maxUploadBytes?: number;
  /** Default visibility is private, even for images. */
  visibility?: 'private' | 'public';
  /** Host-owned per-request object policy; absence denies request-facing operations. */
  authorize?: (
    request: Request,
    address: FileAddress,
    action: 'read' | 'write' | 'delete',
    info?: FileInfo
  ) => boolean | Promise<boolean>;
}
/** Configure a files-backed media facade over a borrowed manager. No persistent resource is acquired and this facade does not close the manager. Request-facing writes require host authorization; trusted stat/list remain separate.
 * @param {StorageManager} manager - Borrowed named-storage manager; the host retains provider lifecycle ownership.
 * @param {MediaFilesOptions} options - Bucket/prefix, upload policy and per-object authorization callback.
 * @returns {object} Media operations; host routing owns authentication, CSRF and request lifetime.
 */
export function createMediaFilesService(
  manager: StorageManager,
  options: MediaFilesOptions
) {
  if (!options?.bucket) {
    throw new TypeError('Media storage bucket required');
  }
  /** Host-configured object namespace, default media/; validated before use. */
  const prefix = options.prefix ?? 'media/';
  if (
    prefix &&
    (!/^[A-Za-z0-9_/-]+\/$/.test(prefix) ||
      prefix.includes('..') ||
      prefix.startsWith('/'))
  ) {
    throw new TypeError('Invalid media prefix');
  }
  /** Map only validated opaque IDs into the fixed storage/bucket/prefix namespace.
   * @param {string} id - Lowercase UUID generated for this service.
   * @returns {FileAddress} Fixed host namespace plus opaque object key; not an authorization grant.
   */
  const address = (id: string): FileAddress => {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
    ) {
      throw new TypeError('Invalid media ID');
    }
    return {
      storage: options.storage,
      bucket: options.bucket,
      key: prefix + id,
    };
  };
  return {
    /** Authorize a fresh opaque address, then delegate bounded raw-body streaming to files. Metadata is returned only after storage succeeds.
     * @param {Request} request - Host-authenticated raw upload request.
     * @param {object} uploadOptions - Optional inert name, lower byte ceiling and expiry.
     * @param {string} [uploadOptions.name] - Inert display filename, default upload.
     * @param {number} [uploadOptions.maxBytes] - Per-upload ceiling capped by service policy.
     * @param {string} [uploadOptions.expiresAt] - Optional storage expiry.
     * @returns {Promise<object>} New opaque ID and stored file facts; rejected/failed writes propagate.
     */
    async upload(
      request: Request,
      uploadOptions: {
        /** Optional inert display filename, default upload; never a storage key. */
        name?: string;
        /** Optional per-upload byte ceiling capped by the service ceiling. */
        maxBytes?: number;
        /** Optional expiry metadata validated by files. */
        expiresAt?: string;
      } = {}
    ) {
      /** Fresh random identifier independent of display names and request-supplied paths. */
      const id = randomUUID();
      /** Tenant-authorized storage address checked before the requested operation. */
      const target = address(id);
      if (
        !options.authorize ||
        !(await options.authorize(request, target, 'write'))
      ) {
        throw Object.assign(new Error('Media upload forbidden'), {
          code: 'FORBIDDEN',
        });
      }
      /** Inert display metadata, bounded and rejected on control characters. */
      const rawName = uploadOptions.name ?? 'upload';
      // eslint-disable-next-line no-control-regex -- Intentionally matches control characters for validation or output sanitization.
      if (rawName.length > 180 || /[\x00-\x1f\x7f]/.test(rawName)) {
        throw new TypeError('Unsafe upload name');
      }
      /** Stored metadata from the borrowed provider; authorization still governs exposure. */
      const info = await uploadFileRequest(manager, target, request, {
        maxBytes: Math.min(
          uploadOptions.maxBytes ?? Number.MAX_SAFE_INTEGER,
          options.maxUploadBytes ?? 16 * 1024 * 1024
        ),
        metadata: { originalName: rawName },
        visibility: options.visibility ?? 'private',
        expiresAt: uploadOptions.expiresAt,
      });
      return { id, info };
    },
    // Trusted server-side operations; use statAuthorized/listAuthorized for
    // request-facing APIs so private metadata cannot be enumerated.
    /** Read metadata as a trusted server operation without invoking request authorization.
     * @param {string} id - Opaque media ID scoped to this configured namespace.
     * @returns {Promise<FileInfo | null>} Private storage facts or null; use statAuthorized for request-facing metadata.
     */
    async stat(id: string) {
      return manager.stat(address(id));
    },
    /** Read existing metadata and apply the host read policy before exposing it.
     * @param {string} id - Opaque namespace-bound media ID.
     * @param {Request} request - Host-authenticated request used by the authorization callback.
     * @returns {Promise<FileInfo | null>} Authorized metadata or null for a missing object; denied access rejects.
     */
    async statAuthorized(id: string, request: Request) {
      /** Tenant-authorized storage address checked before the requested operation. */
      const target = address(id);
      /** Stored metadata from the borrowed provider; authorization still governs exposure. */
      const info = await manager.stat(target);
      if (!info) {
        return null;
      }
      if (
        !options.authorize ||
        !(await options.authorize(request, target, 'read', info))
      ) {
        throw Object.assign(new Error('Media read forbidden'), {
          code: 'FORBIDDEN',
        });
      }
      return info;
    },
    /** Delegate conditional/range byte responses with the configured per-request authorization policy.
     * @param {string} id - Opaque media ID.
     * @param {Request} request - Host-authenticated request and conditional/range headers.
     * @param {object} opts - Optional inline/display-name policy; no arbitrary local path.
     * @param {boolean} [opts.inline] - Request inline content under the files MIME policy.
     * @param {string} [opts.downloadName] - Inert download display name.
     * @returns {Promise<Response>} Files-owned streaming response; caller must consume or cancel the body.
     */
    async download(
      id: string,
      request: Request,
      opts: {
        /** Optional inline request subject to files response MIME policy. */
        inline?: boolean;
        /** Optional safe Content-Disposition display name. */
        downloadName?: string;
      } = {}
    ) {
      return createFileResponse(manager, address(id), request, {
        ...opts,
        authorize: options.authorize,
      });
    },
    /** Require delete authorization before delegating binary removal; catalog ownership remains separate.
     * @param {string} id - Opaque media ID.
     * @param {Request} request - Host-authenticated request used by the delete policy.
     * @returns {Promise<boolean>} Storage deletion result; authorization and provider errors propagate.
     */
    async remove(id: string, request: Request) {
      /** Tenant-authorized storage address checked before the requested operation. */
      const target = address(id);
      if (
        !options.authorize ||
        !(await options.authorize(request, target, 'delete'))
      ) {
        throw Object.assign(new Error('Media delete forbidden'), {
          code: 'FORBIDDEN',
        });
      }
      return manager.delete(target);
    },
    /** Page storage metadata as a trusted server operation, without per-request authorization.
     * @param {object} opts - Optional provider page limit and opaque continuation.
     * @param {number} [opts.limit] - Provider page size.
     * @param {string} [opts.cursor] - Opaque continuation within the configured namespace.
     * @returns {Promise<object>} Private metadata page with derived media IDs; use listAuthorized at HTTP boundaries.
     */
    async list(
      opts: {
        /** Optional provider-bounded page size. */
        limit?: number;
        /** Opaque provider continuation, never proof of authorization. */
        cursor?: string;
      } = {}
    ) {
      /** Provider page fetched within the fixed namespace; individual visibility is separate. */
      const result = await manager.list(options.bucket, {
        storage: options.storage,
        prefix,
        limit: opts.limit,
        cursor: opts.cursor,
      });
      return {
        ...result,
        items: result.items.map((info) => ({
          ...info,
          id: info.key.slice(prefix.length),
        })),
      };
    },
    /** Filter each fetched metadata record through fresh host authorization and suppress raw cursors when any record is denied.
     * @param {Request} request - Host-authenticated request.
     * @param {object} opts - Optional provider page limit and opaque continuation.
     * @param {number} [opts.limit] - Provider page size.
     * @param {string} [opts.cursor] - Opaque continuation within the configured namespace.
     * @returns {Promise<object>} Visible metadata page; a filtered page does not imply the backend has no later records.
     */
    async listAuthorized(
      request: Request,
      opts: {
        /** Optional provider-bounded page size. */
        limit?: number;
        /** Opaque provider continuation, never proof of authorization. */
        cursor?: string;
      } = {}
    ) {
      if (!options.authorize) {
        throw Object.assign(new Error('Media listing forbidden'), {
          code: 'FORBIDDEN',
        });
      }
      /** Provider page fetched within the fixed namespace; individual visibility is separate. */
      const result = await manager.list(options.bucket, {
        storage: options.storage,
        prefix,
        limit: opts.limit,
        cursor: opts.cursor,
      });
      /** Operation-local authorized metadata records; denied keys never enter the response. */
      const visible = [];
      let denied = false;
      // Authorize every record independently before exposing metadata or a continuation.
      for (const info of result.items) {
        if (
          await options.authorize(
            request,
            { storage: options.storage, bucket: options.bucket, key: info.key },
            'read',
            info
          )
        ) {
          visible.push({ ...info, id: info.key.slice(prefix.length) });
        } else {
          denied = true;
        }
      }
      // Backend page cursors can contain the last raw object key. Suppress
      // them when that page contained unauthorized objects, rather than
      // disclosing another tenant's key via pagination metadata.
      return {
        items: visible,
        ...(!denied && result.nextCursor
          ? { nextCursor: result.nextCursor }
          : {}),
      };
    },
    address,
  };
}
