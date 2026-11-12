import { createNativeS3Multipart } from './s3-multipart.js';
import { Readable } from 'node:stream';
import {
  resolveAwsCredentials,
  validateAwsCredentialOptions,
} from '../aws-credentials.js';
import type { AwsCredentialOptions } from '../aws-credentials.js';
import { createHash } from 'node:crypto';
import type {
  FileAddress,
  FileInfo,
  FileSource,
  PutFileOptions,
  ReadFileOptions,
  StorageDriver,
  ListFileOptions,
} from '../types.js';
import {
  chunks,
  validateAddress,
  validateBucket,
  validatePut,
  validateRange,
} from '../validation.js';

export type S3Encryption =
  | {
      /** Explicit supported encryption mode; provider support/permissions remain separately required. */
      mode: 'AES256';
    }
  | {
      /** Explicit supported encryption mode; provider support/permissions remain separately required. */
      mode: 'aws:kms';
      /** Optional private KMS key/alias identifier sent only to the provider. */
      keyId?: string;
      /** Optional AWS KMS bucket-key request; provider support must be qualified. */
      bucketKeyEnabled?: boolean;
    }
  | {
      /** Explicit supported encryption mode; provider support/permissions remain separately required. */
      mode: 'SSE-C';
      /** Private base64-encoded 32-byte SSE-C key; requires HTTPS and cannot use public CDN output. */
      customerKeyBase64: string;
    };
/** Lazy native-client driver; trusted escape hatches do not replace host authorization. */
export interface S3StorageDriver extends StorageDriver {
  /** Stable adapter discriminator, not a complete provider-compatibility certification. */
  readonly kind: 'aws-s3';
  /** Return the borrowed client or coalesce lazy owned SDK construction. Closing fences late access; factory failure clears the pending creation slot.
   * @returns {Promise<object>} Trusted SDK client escape hatch; never expose credentials/client to browsers.
   */
  getClient(): Promise<{
    /** Dispatch one SDK command through the selected client; retry policy remains explicitly SDK-owned.
     * @param {any} command - Trusted official SDK command built by this server adapter.
     * @returns {Promise<any>} Native response or private provider failure; no facade-level replay.
     */
    send(command: any): Promise<any>;
    destroy?(): void;
  }>;
}
export interface S3StorageOptions extends AwsCredentialOptions {
  /** AWS region, or signing region for MinIO/RustFS/S3-compatible endpoints. */
  region?: string;
  /** Optional fixed HTTP(S) origin; credentials, path prefixes, query and fragments reject. */
  endpoint?: string;
  /** Exact configured endpoint origins approved by the host; DNS/egress enforcement remains host-owned. */
  allowedEndpointOrigins?: readonly string[];
  /** Explicit backend qualifications for custom endpoints (unknown by default). */
  providerCapabilities?: Partial<
    Pick<
      import('../types.js').StorageCapabilities,
      | 'range'
      | 'multipart'
      | 'signedUrls'
      | 'createOnlyWrite'
      | 'resumableMultipart'
      | 'multipartCreateOnly'
    >
  >;
  /** Defaults true for custom S3 endpoints (MinIO, RustFS, R2, Ceph), false for AWS. */
  forcePathStyle?: boolean;
  /** Opt into HTTP for trusted on-premise S3 endpoints. Never use over untrusted networks. */
  allowInsecureHttp?: boolean;
  /** AWS S3 access-point ARN region support; not available on all third-party endpoints. */
  useArnRegion?: boolean;
  /** Controls optional AWS SDK retry behavior. */
  maxAttempts?: number;

  /** Optional configured backend encryption; no cross-provider parity guarantee. */
  encryption?: S3Encryption;
  /** Public custom domain / CloudFront domain. Never makes an object public by itself. */
  publicBaseUrl?: string;
  /** Private trusted CloudFront signer configuration; requires publicBaseUrl. */
  cloudFrontSigning?: {
    /** Private server signer key-pair identifier; not browser configuration. */
    keyPairId: string;
    /** Private CloudFront signing key; never return or log it. */
    privateKey: string;
  };
  /** CloudFront distributions may map a single bucket to their origin root. */
  publicPathStyle?: 'bucket-key' | 'key-only';
  /** Use dependency-injected AWS SDK compatible client for tests or shared clients. */
  client?: {
    /** Dispatch one SDK command through the selected client; retry policy remains explicitly SDK-owned.
     * @param {any} command - Trusted official SDK command built by this server adapter.
     * @returns {Promise<any>} Native response or private provider failure; no facade-level replay.
     */
    send(command: any): Promise<any>;
    destroy?(): void;
  };
  /** Default false; if true, close() also destroys an injected client. */
  ownClient?: boolean;
  /** Optional SDK multipart part/concurrency budgets. */
  multipart?: {
    /** Multipart part bytes, 5–512 MiB when configured. */
    partSize?: number;
    /** Multipart upload concurrency, 1–32 when configured. */
    queueSize?: number;
  };
}
/** Validate an explicit S3 configuration and expose an inert lazy SDK facade. Custom endpoint capabilities require host qualification; application identity never selects signing credentials.
 * @param {S3StorageOptions} options - Trusted server endpoint, credentials, capability and resource-ownership policy.
 * @returns {S3StorageDriver} Driver with an explicit close owner; borrowed clients remain host-owned unless ownClient is true.
 */
export function createS3Storage(options: S3StorageOptions): S3StorageDriver {
  if (!options || typeof options !== 'object') {
    throw new TypeError('S3 options required');
  }
  options = {
    ...options,
    encryption: options.encryption ? { ...options.encryption } : undefined,
    multipart: options.multipart ? { ...options.multipart } : undefined,
  };
  /** Validated signing region; defaults to us-east-1, distinct from application tenancy. */
  const region = options?.region ?? 'us-east-1';
  if (!/^[A-Za-z0-9-]{1,64}$/.test(region)) {
    throw new TypeError('Invalid S3 region');
  }
  validateAwsCredentialOptions(options);
  if (
    options.client &&
    (typeof options.client.send !== 'function' ||
      [
        options.credentials,
        options.profile,
        options.assumeRole,
        options.webIdentity,
        options.rolesAnywhere,
        options.onCredentialStatus,
      ].some((value) => value !== undefined))
  ) {
    throw new TypeError('Injected clients own their credential configuration');
  }
  // Reject coercible truthy values before configuring native transport/ownership behavior.
  for (const flag of [
    options.ownClient,
    options.allowInsecureHttp,
    options.forcePathStyle,
    options.useArnRegion,
  ]) {
    if (flag !== undefined && typeof flag !== 'boolean') {
      throw new TypeError('Invalid S3 boolean option');
    }
  }
  if (
    options.maxAttempts !== undefined &&
    (!Number.isSafeInteger(options.maxAttempts) ||
      options.maxAttempts < 1 ||
      options.maxAttempts > 20)
  ) {
    throw new RangeError('Invalid S3 retry count');
  }
  /** Parse a bounded URL without forwarding its raw value in validation errors.
   * @param {string} value - Trusted configured endpoint/CDN URL, rejected if malformed or containing whitespace/control characters.
   * @param {string} message - Fixed public error text, never a secret URL.
   * @returns {URL} Parsed URL for subsequent scheme/origin/path policy checks.
   */
  function storageUrl(value: string, message: string) {
    if (
      typeof value !== 'string' ||
      !value ||
      value.length > 2048 ||
      // eslint-disable-next-line no-control-regex -- Intentionally reject control characters in configured endpoints.
      /[\x00-\x20\x7f]/.test(value)
    ) {
      throw new TypeError(message);
    }
    try {
      return new URL(value);
    } catch {
      throw new TypeError(message);
    }
  }
  if (
    options.allowedEndpointOrigins !== undefined &&
    (!Array.isArray(options.allowedEndpointOrigins) ||
      options.allowedEndpointOrigins.length > 32 ||
      options.allowedEndpointOrigins.some((origin) => {
        try {
          /** Parsed exact endpoint approval checked without contacting the network. */
          const u = storageUrl(origin, 'Invalid endpoint approvals');
          return (
            u.origin !== origin || !['http:', 'https:'].includes(u.protocol)
          );
        } catch {
          return true;
        }
      }))
  ) {
    throw new TypeError('Invalid endpoint approvals');
  }
  if (options.endpoint !== undefined) {
    /** Configured endpoint/CDN URL being checked before any SDK construction. */
    const parsed = storageUrl(options.endpoint, 'Invalid S3 endpoint');
    if (
      !['https:', 'http:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new TypeError('Invalid S3 endpoint');
    }
    if (parsed.pathname !== '/') {
      throw new TypeError('S3 endpoint paths are unsupported');
    }
    if (
      options.allowedEndpointOrigins &&
      !options.allowedEndpointOrigins.includes(parsed.origin)
    ) {
      throw new TypeError('S3 endpoint is not approved');
    }
    if (parsed.protocol === 'http:' && !options.allowInsecureHttp) {
      throw new TypeError('HTTP S3 endpoints require allowInsecureHttp');
    }
    if (options.encryption?.mode === 'SSE-C' && parsed.protocol === 'http:') {
      throw new TypeError('SSE-C customer keys require HTTPS');
    }
  }
  if (
    options.encryption &&
    !['AES256', 'aws:kms', 'SSE-C'].includes(options.encryption.mode)
  ) {
    throw new TypeError('Unsupported S3 encryption');
  }
  if (options.publicBaseUrl !== undefined) {
    /** Configured endpoint/CDN URL being checked before any SDK construction. */
    const parsed = storageUrl(
      options.publicBaseUrl,
      'Public CDN URL must use HTTPS'
    );
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new TypeError('Public CDN URL must use HTTPS');
    }
  }
  if (
    options.publicPathStyle &&
    !['bucket-key', 'key-only'].includes(options.publicPathStyle)
  ) {
    throw new TypeError('Invalid CDN path style');
  }
  if (options.cloudFrontSigning && !options.publicBaseUrl) {
    throw new TypeError('CloudFront signing requires publicBaseUrl');
  }
  if (
    options.cloudFrontSigning &&
    (!options.cloudFrontSigning.keyPairId ||
      !options.cloudFrontSigning.privateKey)
  ) {
    throw new TypeError('CloudFront signing keys required');
  }
  if (options.encryption?.mode === 'SSE-C' && options.publicBaseUrl) {
    throw new TypeError('SSE-C objects cannot use public CDN URLs');
  }
  if (
    options.multipart?.partSize !== undefined &&
    (!Number.isSafeInteger(options.multipart.partSize) ||
      options.multipart.partSize < 5 * 1024 * 1024 ||
      options.multipart.partSize > 512 * 1024 * 1024)
  ) {
    throw new RangeError('Invalid S3 multipart part size');
  }
  if (
    options.multipart?.queueSize !== undefined &&
    (!Number.isSafeInteger(options.multipart.queueSize) ||
      options.multipart.queueSize < 1 ||
      options.multipart.queueSize > 32)
  ) {
    throw new RangeError('Invalid S3 multipart concurrency');
  }
  if (
    options.encryption?.mode === 'SSE-C' &&
    Buffer.from(options.encryption.customerKeyBase64, 'base64').length !== 32
  ) {
    throw new TypeError('SSE-C requires a base64-encoded 32-byte key');
  }
  /** Host capability declarations copied into an immutable snapshot after validation. */
  const declared = options.providerCapabilities ?? {};
  if (
    Object.keys(declared).some(
      (key) =>
        ![
          'range',
          'multipart',
          'signedUrls',
          'createOnlyWrite',
          'resumableMultipart',
          'multipartCreateOnly',
        ].includes(key)
    ) ||
    Object.values(declared).some(
      (value) => value !== true && value !== false && value !== 'unknown'
    )
  ) {
    throw new TypeError('Invalid S3 capabilities');
  }
  /** AWS defaults are affirmative; custom endpoint features remain unknown unless qualified. */
  const supported = options.endpoint ? 'unknown' : true;
  /** Frozen provider claims; conditional stream/copy writes deliberately remain unsupported. */
  const capabilities = Object.freeze({
    range: declared.range ?? supported,
    multipart: declared.multipart ?? supported,
    resumableMultipart: declared.resumableMultipart ?? supported,
    multipartCreateOnly: declared.multipartCreateOnly ?? supported,
    signedUrls: declared.signedUrls ?? supported,
    createOnlyWrite: declared.createOnlyWrite ?? supported,
    createOnlyStream: false,
    createOnlyCopy: false,
    encryption: Object.freeze(
      options.encryption ? [options.encryption.mode] : []
    ),
  });
  /** Require affirmative provider qualification before dispatching a capability-dependent operation.
   * @param {boolean | 'unknown'} value - Frozen capability value; unknown is not support.
   * @returns {void} Unsupported/unverified values throw UNSUPPORTED_CAPABILITY.
   */
  function requireCapability(value: boolean | 'unknown') {
    if (value !== true) {
      throw Object.assign(
        new Error('Storage capability is unsupported or unverified'),
        { code: 'UNSUPPORTED_CAPABILITY' }
      );
    }
  }
  let client: S3StorageOptions['client'] | undefined = options.client;
  let creating: Promise<NonNullable<S3StorageOptions['client']>> | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  /** Return the borrowed client or coalesce lazy owned SDK construction. Closing fences late access; factory failure clears the pending creation slot.
   * @returns {Promise<object>} Trusted SDK client escape hatch; never expose credentials/client to browsers.
   */
  async function getClient() {
    if (closed) {
      throw new Error('S3 connection closed');
    }
    if (client) {
      return client;
    }
    /** Observed SDK/client/object result; absence after commit remains an explicit error. */
    const found = await (creating ??= Promise.all([
      import('@aws-sdk/client-s3'),
      resolveAwsCredentials(options, region),
    ])
      .then(
        ([{ S3Client }, credentials]) =>
          (client = new S3Client({
            region,
            endpoint: options.endpoint,
            forcePathStyle: options.forcePathStyle ?? !!options.endpoint,
            useArnRegion: options.useArnRegion,
            maxAttempts: options.maxAttempts,
            followRegionRedirects: false,
            ...(credentials ? { credentials } : {}),
          }))
      )
      .catch((error) => {
        creating = undefined;
        throw error;
      }));
    if (closed) {
      throw new Error('S3 connection closed');
    }
    return found;
  }
  /** Dispatch one SDK command through the selected client; retry policy remains explicitly SDK-owned.
   * @param {any} command - Trusted official SDK command built by this server adapter.
   * @returns {Promise<any>} Native response or private provider failure; no facade-level replay.
   */
  async function send(command: any) {
    return (await getClient()).send(command);
  }
  /** Build command-specific encryption fields; write-only SSE/KMS fields are omitted on reads.
   * @param {boolean} forRead - Use read-side headers when true; defaults false.
   * @returns {Record<string, unknown>} Private signing/encryption fields; SSE-C keys must never enter logs.
   */
  function encryptionHeaders(forRead = false): Record<string, unknown> {
    switch (options.encryption?.mode) {
      case 'AES256':
        return forRead ? {} : { ServerSideEncryption: 'AES256' };
      case 'aws:kms':
        return forRead
          ? {}
          : {
              ServerSideEncryption: 'aws:kms',
              SSEKMSKeyId: options.encryption.keyId,
              BucketKeyEnabled: options.encryption.bucketKeyEnabled,
            };
      case 'SSE-C': {
        /** Private SSE-C key material used only to derive request headers. */
        const customer = options.encryption.customerKeyBase64;
        return {
          SSECustomerAlgorithm: 'AES256',
          SSECustomerKey: customer,
          SSECustomerKeyMD5: createHash('md5')
            .update(Buffer.from(customer, 'base64'))
            .digest('base64'),
        };
      }
      default:
        return {};
    }
  }
  /** Format a configured CDN/public path without changing object permissions or issuing a request.
   * @param {FileAddress} a - Validated object address; public reachability remains host/provider policy.
   * @returns {string | undefined} Configured HTTPS URL or undefined; closed drivers reject.
   */
  function url(a: FileAddress) {
    if (closed) {
      throw new Error('S3 connection closed');
    }
    validateAddress(a);
    if (!options.publicBaseUrl) {
      return undefined;
    }
    return (
      options.publicBaseUrl.replace(/\/$/, '') +
      '/' +
      (options.publicPathStyle === 'key-only'
        ? ''
        : encodeURIComponent(a.bucket) + '/') +
      a.key.split('/').map(encodeURIComponent).join('/')
    );
  }
  /** Combine caller metadata with the adapter-owned visibility marker.
   * @param {Record<string, string> | undefined} meta - Validated application metadata, copied before use.
   * @param {'private' | 'public'} visibility - Application metadata visibility; does not configure AWS ACL/IAM.
   * @returns {object} New metadata map with the reserved visibility marker.
   */
  function metadata(
    meta: Record<string, string> | undefined,
    visibility: 'private' | 'public'
  ) {
    return { ...meta, 'zfiles-visibility': visibility };
  }
  /** Normalize native object metadata while removing adapter-owned keys from the public user-metadata map.
   * @param {FileAddress} a - Validated addressed object.
   * @param {any} head - Trusted native SDK metadata response; not arbitrary browser JSON.
   * @returns {FileInfo} Provider-shaped metadata; ETag is not necessarily a full-object content hash.
   */
  function result(a: FileAddress, head: any): FileInfo {
    /** Native reserved/user metadata map before adapter-owned markers are removed. */
    const data = head.Metadata ?? {};
    /** Copied user-visible metadata map excluding reserved adapter markers. */
    const user = { ...data };
    delete user['zfiles-visibility'];
    delete user['zfiles-expires'];
    /** Application visibility marker, private by default; not an AWS permission. */
    const visibility =
      data['zfiles-visibility'] === 'public' ? 'public' : 'private';
    return {
      bucket: a.bucket,
      key: a.key,
      size: Number(head.ContentLength ?? head.Size ?? 0),
      etag: String(head.ETag ?? '').replace(/^"|"$/g, '')
        ? String(head.ETag)
        : '',
      contentType: head.ContentType ?? 'application/octet-stream',
      modifiedAt: (head.LastModified instanceof Date
        ? head.LastModified
        : new Date(head.LastModified ?? Date.now())
      ).toISOString(),
      visibility,
      metadata: user,
      cacheControl: head.CacheControl,
      contentDisposition: head.ContentDisposition,
      versionId: head.VersionId,
      rangeSupported: capabilities.range === true,
      encryption:
        options.encryption?.mode === 'SSE-C'
          ? 'SSE-C'
          : head.ServerSideEncryption,
      expiresAt: data['zfiles-expires'],
    };
  }
  /** Read metadata without returning binary content. Managers reject expired records; drivers expose native metadata.
   * @param {FileAddress} a - Bucket/key plus optional named storage; authorization remains host-owned.
   * @returns {Promise<FileInfo | null>} Metadata or null for a missing object; provider failures propagate.
   */
  async function stat(a: FileAddress): Promise<FileInfo | null> {
    validateAddress(a);
    /** Official lazy metadata command constructor. */
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    try {
      return result(
        a,
        await send(
          new HeadObjectCommand({
            Bucket: a.bucket,
            Key: a.key,
            ...encryptionHeaders(true),
          })
        )
      );
    } catch (e) {
      /** Private native error metadata used only to classify missing objects. */
      const err = e as {
        name?: string;
        $metadata?: { httpStatusCode?: number };
      };
      if (
        ['NotFound', 'NoSuchKey'].includes(err.name ?? '') ||
        err.$metadata?.httpStatusCode === 404
      ) {
        return null;
      }
      throw e;
    }
  }
  /** Lazy owned S3 facade, separate from host principal authentication. */
  const driver: S3StorageDriver = {
    kind: 'aws-s3',
    capabilities,
    multipartOperations:
      capabilities.resumableMultipart === true
        ? createNativeS3Multipart(
            getClient,
            encryptionHeaders,
            capabilities.multipartCreateOnly === true
          )
        : undefined,
    getClient,
    /** Persist binary content under the configured driver/policy; an error after dispatch may have an uncertain commit outcome.
     * @param {FileAddress} a - Bucket/key plus optional named storage; authorization remains host-owned.
     * @param {FileSource} source - Borrowed bytes or stream; consumption and cancellation remain cooperative.
     * @param {PutFileOptions} opts - Optional write metadata, limits, create-only policy and cooperative cancellation.
     * @returns {Promise<FileInfo>} Committed provider metadata; create-only behavior depends on declared capabilities.
     */
    async put(a: FileAddress, source: FileSource, opts: PutFileOptions = {}) {
      validateAddress(a);
      validatePut(opts);
      if (opts.signal?.aborted) {
        throw opts.signal.reason;
      }
      // Buffer writes use atomic PutObject preconditions. Multipart/copy cannot
      // promise destination create-only semantics through this shared adapter.
      /** Explicit write byte ceiling, independently enforced before/between source chunks. */
      const max = opts.maxBytes ?? Number.MAX_SAFE_INTEGER;
      if (source instanceof Uint8Array) {
        if (opts.ifNoneMatch !== false) {
          requireCapability(capabilities.createOnlyWrite);
        }
        if (source.byteLength > max) {
          throw new RangeError('File size exceeds limit');
        }
        /** Official lazy byte-buffer write command supporting native preconditions. */
        const { PutObjectCommand } = await import('@aws-sdk/client-s3');
        /** Copied application metadata plus optional adapter-owned expiry marker. */
        const userMetadata = { ...opts.metadata };
        if (opts.expiresAt) {
          userMetadata['zfiles-expires'] = opts.expiresAt;
        }
        try {
          await send(
            new PutObjectCommand({
              Bucket: a.bucket,
              Key: a.key,
              Body: source,
              ContentType: opts.contentType ?? 'application/octet-stream',
              ContentDisposition: opts.contentDisposition,
              CacheControl: opts.cacheControl,
              Metadata: metadata(userMetadata, opts.visibility ?? 'private'),
              ...encryptionHeaders(),
              ...(opts.ifNoneMatch !== false ? { IfNoneMatch: '*' } : {}),
            })
          );
        } catch (error) {
          /** Private SDK status/name used to translate a definite conditional-write conflict. */
          const code = error as {
            name?: string;
            $metadata?: { httpStatusCode?: number };
          };
          if (
            code.name === 'PreconditionFailed' ||
            code.$metadata?.httpStatusCode === 412
          ) {
            throw Object.assign(new Error('File exists'), {
              code: 'FILE_EXISTS',
            });
          }
          throw error;
        }
        /** Native object metadata observed after a provider operation or listing lookup. */
        const info = await stat(a);
        if (!info) {
          throw new Error('S3 object not visible after upload');
        }
        return info;
      }
      requireCapability(capabilities.multipart);
      if (opts.ifNoneMatch !== false) {
        requireCapability(capabilities.createOnlyStream);
      }
      /** Official bounded multipart uploader loaded only for a permitted streamed write. */
      const { Upload } = await import('@aws-sdk/lib-storage');
      /** Count actual stream bytes before converting chunks for the SDK multipart uploader.
       * @returns {AsyncGenerator<Buffer>} Bounded binary chunks; cancellation is observed at source checkpoints.
       */
      async function* bounded() {
        let bytes = 0;
        // Bound each observed chunk before the SDK multipart uploader retains it.
        for await (const piece of chunks(source, opts.signal)) {
          bytes += piece.byteLength;
          if (!Number.isSafeInteger(bytes) || bytes > max) {
            throw new RangeError('File size exceeds limit');
          }
          yield Buffer.from(piece);
        }
      }
      /** Copied application metadata plus optional adapter-owned expiry marker. */
      const userMetadata = { ...opts.metadata };
      if (opts.expiresAt) {
        userMetadata['zfiles-expires'] = opts.expiresAt;
      }
      /** Private SDK command input; may contain metadata/encryption fields and must not be logged. */
      const request = {
        Bucket: a.bucket,
        Key: a.key,
        Body: Readable.from(bounded()),
        ContentType: opts.contentType ?? 'application/octet-stream',
        ContentDisposition: opts.contentDisposition,
        CacheControl: opts.cacheControl,
        Metadata: metadata(userMetadata, opts.visibility ?? 'private'),
        ...encryptionHeaders(),
        ...(opts.ifNoneMatch !== false ? { IfNoneMatch: '*' } : {}),
      };
      /** Operation-owned SDK multipart uploader; leavePartsOnError false requests cleanup on failure. */
      const uploader = new Upload({
        client: (await getClient()) as any,
        params: request,
        leavePartsOnError: false,
        partSize: options.multipart?.partSize,
        queueSize: options.multipart?.queueSize,
      });
      /** Forward request abort to the native uploader; this is cooperative and not proof of rollback.
       * @returns {Promise<void>} Native uploader abort observation. */
      const abort = () => uploader.abort();
      opts.signal?.addEventListener('abort', abort, { once: true });
      try {
        await uploader.done();
      } finally {
        opts.signal?.removeEventListener('abort', abort);
      }
      /** Observed SDK/client/object result; absence after commit remains an explicit error. */
      const found = await stat(a);
      if (!found) {
        throw new Error('S3 object not visible after upload');
      }
      return found;
    },
    stat,
    /** Open a streaming read; consume or close the returned iterator so its underlying resources can release.
     * @param {FileAddress} a - Bucket/key plus optional named storage; authorization remains host-owned.
     * @param {ReadFileOptions} opts - Optional inclusive byte bounds and caller-owned cancellation.
     * @returns {Promise<AsyncIterable<Uint8Array>>} Byte stream, subject to declared range/encryption capabilities.
     */
    async read(a: FileAddress, opts: ReadFileOptions = {}) {
      validateAddress(a);
      validateRange(opts);
      if (opts.start !== undefined || opts.end !== undefined) {
        requireCapability(capabilities.range);
      }
      /** Official lazy streaming-read command constructor. */
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      /** Single inclusive byte-range header built only after range/capability validation. */
      const Range =
        opts.start !== undefined || opts.end !== undefined
          ? `bytes=${opts.start ?? 0}-${opts.end ?? ''}`
          : undefined;
      /** Native streaming response; its body iterator owns byte resource cleanup. */
      const response = await send(
        new GetObjectCommand({
          Bucket: a.bucket,
          Key: a.key,
          Range,
          ...encryptionHeaders(true),
        })
      );
      if (!response.Body) {
        throw new Error('Missing S3 response body');
      }
      /** Borrowed native async body iterable; this facade never buffers the whole object. */
      const body = response.Body as AsyncIterable<Uint8Array>;
      /** Yield native body chunks and observe cancellation between source settlements.
       * @returns {AsyncGenerator<Uint8Array>} Borrowed body stream; consume/return it for native iterator cleanup.
       */
      async function* iterable() {
        // Preserve native body streaming/return ownership while observing cooperative cancellation.
        for await (const part of body) {
          if (opts.signal?.aborted) {
            throw opts.signal.reason;
          }
          yield part;
        }
      }
      return iterable();
    },
    /** Delete one object under configured permissions; this is not a conditional version delete.
     * @param {FileAddress} a - Bucket/key plus optional named storage; authorization remains host-owned.
     * @returns {Promise<boolean>} Whether an object was present for deletion; provider failures propagate.
     */
    async delete(a) {
      validateAddress(a);
      /** Official lazy object-delete command constructor. */
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      /** Predelete existence observation; delete is not version-conditional. */
      const present = await stat(a);
      if (!present) {
        return false;
      }
      await send(new DeleteObjectCommand({ Bucket: a.bucket, Key: a.key }));
      return true;
    },
    /** Return a bounded provider page. Opaque continuations and ordering are driver-specific.
     * @param {string} bucket - Validated bucket within configured policy.
     * @param {ListFileOptions} opts - Optional literal prefix, limit, cursor and manager storage selection.
     * @returns {Promise<FileListing>} Page metadata and optional continuation; not an unbounded scan.
     */
    async list(bucket: string, opts: ListFileOptions = {}) {
      validateBucket(bucket);
      /** Official lazy bounded-list command constructor. */
      const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
      /** Validated provider page size, 1–1000 with default 100. */
      const limit = opts.limit ?? 100;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
        throw new RangeError('Invalid limit');
      }
      /** One native list page; object metadata is fetched separately for each addressed key. */
      const page = await send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: opts.prefix,
          MaxKeys: limit,
          ContinuationToken: opts.cursor,
        })
      );
      /** Validated per-object metadata collected for this bounded provider page. */
      const items: FileInfo[] = [];
      // Resolve metadata only for keys in this bounded list page; no bucket-wide expansion.
      for (const item of page.Contents ?? []) {
        if (item.Key) {
          /** Native object metadata observed after a provider operation or listing lookup. */
          const info = await stat({ bucket, key: item.Key });
          if (info) {
            items.push(info);
          }
        }
      }
      return { items, nextCursor: page.NextContinuationToken };
    },
    /** Copy bytes/metadata subject to destination policy; create-only support must be negotiated.
     * @param {FileAddress} from - Source address; caller must have permission to read it.
     * @param {FileAddress} to - Destination address subject to write policy.
     * @param {PutFileOptions} opts - Optional write metadata, limits, create-only policy and cooperative cancellation.
     * @returns {Promise<FileInfo>} Destination metadata; cross-driver fallback streams without a shared transaction.
     */
    async copy(from, to, opts = {}) {
      validateAddress(from);
      validateAddress(to);
      validatePut(opts);
      if (opts.ifNoneMatch !== false) {
        requireCapability(capabilities.createOnlyCopy);
      }
      /** Official lazy native-copy command constructor. */
      const { CopyObjectCommand } = await import('@aws-sdk/client-s3');
      /** Observed source metadata merged into explicit destination copy options. */
      const source = await stat(from);
      if (!source) {
        throw new Error('Source missing');
      }
      /** Copied application metadata plus optional adapter-owned expiry marker. */
      const userMetadata = { ...source.metadata, ...opts.metadata };
      if (opts.expiresAt) {
        userMetadata['zfiles-expires'] = opts.expiresAt;
      }
      await send(
        new CopyObjectCommand({
          Bucket: to.bucket,
          Key: to.key,
          CopySource: `${encodeURIComponent(from.bucket)}/${from.key.split('/').map(encodeURIComponent).join('/')}`,
          MetadataDirective: 'REPLACE',
          ContentType: opts.contentType ?? source.contentType,
          CacheControl: opts.cacheControl ?? source.cacheControl,
          Metadata: metadata(
            userMetadata,
            opts.visibility ?? source.visibility
          ),
          ...encryptionHeaders(),
        })
      );
      /** Observed SDK/client/object result; absence after commit remains an explicit error. */
      const found = await stat(to);
      if (!found) {
        throw new Error('S3 copy failed');
      }
      return found;
    },
    /** Sign backend access for a bounded lifetime without granting application authorization or changing object visibility.
     * @param {'GET' | 'PUT'} method - Backend operation to sign.
     * @param {FileAddress} a - Bucket/key plus optional named storage; authorization remains host-owned.
     * @param {number} seconds - Safe integer lifetime from 1 to 604800 seconds.
     * @param {PutFileOptions} opts - Optional write metadata, limits, create-only policy and cooperative cancellation.
     * @returns {Promise<string>} Sensitive temporary URL; keep it out of default logs.
     */
    async signedUrl(method, a, seconds, opts) {
      if (closed) {
        throw new Error('S3 connection closed');
      }
      validateAddress(a);
      if (!['GET', 'PUT'].includes(method)) {
        throw new TypeError('Invalid signed method');
      }
      validatePut(opts ?? {});
      requireCapability(capabilities.signedUrls);
      if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 604800) {
        throw new RangeError('Invalid signing lifetime');
      }
      if (method === 'PUT') {
        if (
          opts?.maxBytes !== undefined ||
          opts?.signal !== undefined ||
          opts?.expiresAt !== undefined
        ) {
          throw new TypeError(
            'Signed PUT cannot enforce stream limits or object expiry'
          );
        }
        if (opts?.ifNoneMatch !== false) {
          requireCapability(capabilities.createOnlyWrite);
        }
      }
      if (method === 'GET' && options.cloudFrontSigning) {
        /** Official selected server-side signer; signing does not grant application authorization. */
        const { getSignedUrl } = await import('@aws-sdk/cloudfront-signer');
        /** Private CloudFront signer configuration retained only on the server. */
        const cf = options.cloudFrontSigning;
        return getSignedUrl({
          url: url(a)!,
          keyPairId: cf.keyPairId,
          privateKey: cf.privateKey,
          dateLessThan: new Date(Date.now() + seconds * 1000).toISOString(),
        });
      }
      /** Official SDK command constructors loaded only for the requested signed operation. */
      const s3 = await import('@aws-sdk/client-s3');
      /** Official selected server-side signer; signing does not grant application authorization. */
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      /** Trusted GET/PUT SDK command; never raw caller DSL or an arbitrary URL. */
      const command =
        method === 'GET'
          ? new s3.GetObjectCommand({
              Bucket: a.bucket,
              Key: a.key,
              ...encryptionHeaders(true),
            })
          : new s3.PutObjectCommand({
              Bucket: a.bucket,
              Key: a.key,
              ContentType: opts?.contentType,
              ContentDisposition: opts?.contentDisposition,
              CacheControl: opts?.cacheControl,
              Metadata: metadata(opts?.metadata, opts?.visibility ?? 'private'),
              ...(opts?.ifNoneMatch !== false ? { IfNoneMatch: '*' } : {}),
              ...encryptionHeaders(),
            });
      return getSignedUrl((await getClient()) as any, command, {
        expiresIn: seconds,
      });
    },
    publicUrl: url,
    /** Fence new calls and await pending client construction, then destroy the owned client once. It does not drain every command or terminate a borrowed credential helper.
     * @returns {Promise<void>} Idempotent native-client cleanup; borrowed clients stay open unless ownership was explicitly transferred.
     */
    close() {
      closed = true;
      return (closing ??= (async () => {
        /** Borrowed or lazily created native client considered once during idempotent close. */
        const existing = client ?? (await creating?.catch(() => undefined));
        if ((!options.client || options.ownClient) && existing?.destroy) {
          existing.destroy();
        }
      })());
    },
  };
  return driver;
}
