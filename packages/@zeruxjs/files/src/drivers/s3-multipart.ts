import { createHash } from 'node:crypto';
import type { NativeMultipartOperations } from '../multipart-types.js';
import { validateAddress, validatePut } from '../validation.js';
/** Construct an inert native SDK boundary. The resumable coordinator owns identity, journal, ordering, leases and uncertain-result policy.
 * @param {Function} client - Borrowed lazy client getter; this boundary never destroys the client.
 * @param {Function} encryption - Borrowed trusted encryption-header factory; read mode excludes write-only headers.
 * @param {boolean} createOnly - Host-qualified native conditional-completion capability.
 * @returns {NativeMultipartOperations} Frozen native operations; no network work occurs until invoked.
 */
export function createNativeS3Multipart(
  client: () => Promise<{
    send(command: any, options?: { abortSignal?: AbortSignal }): Promise<any>;
  }>,
  encryption: (read?: boolean) => Record<string, unknown>,
  createOnly: boolean
): NativeMultipartOperations {
  /** Lowercase SHA-256 syntax used before native part/completion dispatch. */
  const digest = /^[a-f0-9]{64}$/;

  /** Validate object/native-upload syntax before building SDK addressing fields.
   * @param {FileAddress} value - Validated storage destination; tenant authorization belongs to the coordinator.
   * @param {string | undefined} id - Optional bounded provider ID; control characters reject.
   * @returns {object} Bucket, Key and optional UploadId for native SDK commands.
   */
  function address(
    value: Parameters<NativeMultipartOperations['initiate']>[0],
    id?: string
  ) {
    validateAddress(value);
    if (
      id !== undefined &&
      (typeof id !== 'string' ||
        !id ||
        id.length > 2048 ||
        // eslint-disable-next-line no-control-regex -- Intentionally reject control characters in native upload IDs.
        /[\x00-\x1f\x7f]/.test(id))
    ) {
      throw new TypeError('Invalid native upload ID');
    }
    return { Bucket: value.bucket, Key: value.key, UploadId: id };
  }
  return Object.freeze({
    minPartBytes: 5 * 1024 * 1024,
    createOnly,
    /** Request SHA-256 composite checksums and preserve application visibility/expiry metadata when creating a native upload.
     * @param {FileAddress} value - Validated storage destination; tenant authorization belongs to the coordinator.
     * @param {PutFileOptions} options - Validated content metadata and encryption policy, not a principal identity.
     * @returns {Promise<string>} Private native UploadId; missing/invalid receipts reject.
     */
    async initiate(value, options) {
      validatePut(options);
      /** Official SDK command constructors loaded only when a native operation runs. */
      const sdk = await import('@aws-sdk/client-s3');
      /** Native provider receipt checked before returning application-visible success. */
      const result = await (
        await client()
      ).send(
        new sdk.CreateMultipartUploadCommand({
          ...address(value),
          ContentType: options.contentType ?? 'application/octet-stream',
          ContentDisposition: options.contentDisposition,
          CacheControl: options.cacheControl,
          Metadata: {
            ...options.metadata,
            'zfiles-visibility': options.visibility ?? 'private',
            ...(options.expiresAt
              ? { 'zfiles-expires': options.expiresAt }
              : {}),
          },
          ChecksumAlgorithm: 'SHA256',
          ChecksumType: 'COMPOSITE',
          ...encryption(),
        })
      );
      address(value, result.UploadId);
      if (!result.UploadId) {
        throw new Error('Missing native upload ID');
      }
      return result.UploadId;
    },
    /** Independently validate part bytes/hash before dispatch, then require provider checksum confirmation.
     * @param {FileAddress} value - Validated storage destination; tenant authorization belongs to the coordinator.
     * @param {string} id - Private native provider upload ID; never sufficient as HTTP authorization.
     * @param {UploadPart} part - Bounded 1-based number, exact size and lowercase SHA-256.
     * @param {Uint8Array} bytes - At most 64 MiB matching the part declaration.
     * @param {AbortSignal | undefined} signal - Caller-owned cooperative SDK cancellation; commit may already have happened.
     * @returns {Promise<string>} Confirmed provider ETag, not an application permission.
     */
    async upload(value, id, part, bytes, signal) {
      if (
        !Number.isSafeInteger(part.number) ||
        part.number < 1 ||
        part.number > 1000 ||
        !digest.test(part.sha256) ||
        !(bytes instanceof Uint8Array) ||
        bytes.byteLength !== part.size ||
        part.size < 1 ||
        createHash('sha256').update(bytes).digest('hex') !== part.sha256 ||
        part.size > 64 * 1024 * 1024
      ) {
        throw new TypeError('Invalid native upload part');
      }
      if (signal?.aborted) {
        throw new Error('Upload cancelled');
      }
      /** Official SDK command constructors loaded only when a native operation runs. */
      const sdk = await import('@aws-sdk/client-s3');
      /** Base64 SHA-256 encoded from the independently verified part bytes. */
      const checksum = Buffer.from(part.sha256, 'hex').toString('base64');
      /** Native provider receipt checked before returning application-visible success. */
      const result = await (
        await client()
      ).send(
        new sdk.UploadPartCommand({
          ...address(value, id),
          PartNumber: part.number,
          Body: bytes,
          ContentLength: part.size,
          ChecksumSHA256: checksum,
          ...encryption(true),
        }),
        { abortSignal: signal }
      );
      if (
        typeof result.ETag !== 'string' ||
        !result.ETag ||
        result.ETag.length > 1024 ||
        result.ChecksumSHA256 !== checksum
      ) {
        throw new Error('Native upload integrity confirmation missing');
      }
      return result.ETag;
    },
    /** Fetch one bounded receipt page and reject truncation rather than assuming completeness.
     * @param {FileAddress} value - Validated storage destination; tenant authorization belongs to the coordinator.
     * @param {string} id - Private native provider upload ID; never sufficient as HTTP authorization.
     * @param {number} maxParts - Positive safe-integer receipt ceiling, at most 1000.
     * @returns {Promise<UploadPart[]>} Validated native receipts normalized to lowercase SHA-256 hex.
     */
    async list(value, id, maxParts) {
      if (!Number.isSafeInteger(maxParts) || maxParts < 1 || maxParts > 1000) {
        throw new RangeError('Invalid native part limit');
      }
      /** Official SDK command constructors loaded only when a native operation runs. */
      const sdk = await import('@aws-sdk/client-s3');
      /** Native provider receipt checked before returning application-visible success. */
      const result = await (
        await client()
      ).send(
        new sdk.ListPartsCommand({
          ...address(value, id),
          MaxParts: maxParts,
          ...encryption(true),
        })
      );
      if (result.IsTruncated || (result.Parts?.length ?? 0) > maxParts) {
        throw new RangeError('Native part limit exceeded');
      }
      return (result.Parts ?? []).map((part: any) => {
        if (
          !Number.isSafeInteger(part.PartNumber) ||
          part.PartNumber < 1 ||
          part.PartNumber > maxParts ||
          !Number.isSafeInteger(part.Size) ||
          part.Size < 1 ||
          typeof part.ETag !== 'string' ||
          typeof part.ChecksumSHA256 !== 'string' ||
          !/^[A-Za-z0-9+/]{43}=$/.test(part.ChecksumSHA256)
        ) {
          throw new Error('Invalid native part receipt');
        }
        return {
          number: part.PartNumber,
          size: part.Size,
          etag: part.ETag,
          sha256: Buffer.from(part.ChecksumSHA256, 'base64').toString('hex'),
        };
      });
    },
    /** Validate contiguous ordered receipts and minimum nonfinal part sizes before one native completion request. Unknown outcomes propagate without replay.
     * @param {FileAddress} value - Validated storage destination; tenant authorization belongs to the coordinator.
     * @param {string} id - Private native provider upload ID; never sufficient as HTTP authorization.
     * @param {UploadPart[]} parts - Nonempty ordered receipts, at most 1000.
     * @param {boolean} conditional - Require qualified create-only completion when true.
     * @param {AbortSignal | undefined} signal - Caller-owned cooperative SDK cancellation; commit may already have happened.
     * @returns {Promise<void>} Provider completion observation; definite 412 conflicts map to FILE_EXISTS.
     */
    async complete(value, id, parts, conditional, signal) {
      if (typeof conditional !== 'boolean' || (conditional && !createOnly)) {
        throw new Error('Native conditional multipart unsupported');
      }
      if (
        !Array.isArray(parts) ||
        !parts.length ||
        parts.length > 1000 ||
        parts.some(
          (p, i) =>
            p.number !== i + 1 ||
            !digest.test(p.sha256) ||
            typeof p.etag !== 'string' ||
            !p.etag ||
            !Number.isSafeInteger(p.size) ||
            p.size < 1 ||
            (i < parts.length - 1 && p.size < 5 * 1024 * 1024)
        )
      ) {
        throw new TypeError('Invalid native completion parts');
      }
      /** Official SDK command constructors loaded only when a native operation runs. */
      const sdk = await import('@aws-sdk/client-s3');
      try {
        await (
          await client()
        ).send(
          new sdk.CompleteMultipartUploadCommand({
            ...address(value, id),
            MultipartUpload: {
              Parts: parts.map((p) => ({
                PartNumber: p.number,
                ETag: p.etag,
                ChecksumSHA256: Buffer.from(p.sha256, 'hex').toString('base64'),
              })),
            },
            ChecksumType: 'COMPOSITE',
            ...(conditional ? { IfNoneMatch: '*' } : {}),
            ...encryption(true),
          }),
          { abortSignal: signal }
        );
      } catch (cause) {
        if (
          (cause as any)?.name === 'PreconditionFailed' ||
          (cause as any)?.$metadata?.httpStatusCode === 412
        ) {
          throw Object.assign(new Error('File exists'), {
            code: 'FILE_EXISTS',
          });
        }
        throw cause;
      }
    },
    /** Request native abort and confirm no parts remain. Coordinator leases exclude active writers; this boundary never breaks a lease.
     * @param {FileAddress} value - Validated storage destination; tenant authorization belongs to the coordinator.
     * @param {string} id - Private native provider upload ID; never sufficient as HTTP authorization.
     * @returns {Promise<void>} Confirmed absence or empty receipt set; transient cleanup failures propagate.
     */
    async abort(value, id) {
      /** Official SDK command constructors loaded only when a native operation runs. */
      const sdk = await import('@aws-sdk/client-s3');
      /** Validated native upload address reused for abort and confirmation. */
      const request = address(value, id);
      try {
        await (
          await client()
        ).send(new sdk.AbortMultipartUploadCommand(request));
      } catch (error) {
        if ((error as any)?.name === 'NoSuchUpload') {
          return;
        }
        throw error;
      }
      // No part writers are active under the coordinator lease; require provider confirmation.
      try {
        /** Native provider receipt checked before returning application-visible success. */
        const result = await (
          await client()
        ).send(new sdk.ListPartsCommand({ ...request, MaxParts: 1 }));
        if (result.IsTruncated || result.Parts?.length) {
          throw new Error('Native abort is not yet complete');
        }
      } catch (error) {
        if ((error as any)?.name !== 'NoSuchUpload') {
          throw error;
        }
      }
    },
  } satisfies NativeMultipartOperations);
}
