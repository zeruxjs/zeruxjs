import type {
  ResumableUploads,
  UploadIdentity,
  UploadSession,
  FileAddress,
  FileInfo,
} from '@zeruxjs/files';
import { mediaRequestBody } from './request-body.js';
export interface MediaResumableOptions {
  /** Borrowed files-owned resumable coordinator and durable journal; not closed here. */
  uploads: ResumableUploads;
  /** Explicit absolute route mount without trailing slash; host registers routing separately. */
  prefix: string;
  /** Required host-verified tenant/subject resolver after request authorization. */
  identify: (request: Request) => UploadIdentity | Promise<UploadIdentity>;
  /** Authenticate/authorize and apply origin/CSRF policy for writes, even on retries. */
  authorizeRequest: (request: Request) => boolean | Promise<boolean>;
  /** Trusted synchronous address selector bound to verified identity and validated upload facts. */
  destination: (
    identity: UploadIdentity,
    input: {
      /** Inert bounded display name; no caller-selected storage path. */
      name: string; /** Declared MIME constrained to the configured allowlist. */
      contentType: string; /** Positive safe-integer expected complete byte length. */
      size: number; /** Expected lowercase complete SHA-256; files verifies integrity before commit. */
      sha256: string;
    }
  ) => FileAddress;
  /** Nonempty MIME allowlist, maximum 100 bare declared MIME values; not content sniffing. */
  allowedTypes: readonly string[];
  /** Planned part size, default 5 MiB and maximum 64 MiB. */
  partBytes?: number;
  /** Positive total upload ceiling, default 1 GiB; files provider/journal limits still apply. */
  maxBytes?: number;
  /** Process-local admitted request ceiling, default 8 and maximum 64. */
  maxPending?: number;
  /** Private failure observer; must redact causes before logging. Observer failure cannot alter the response. */
  onError?: (
    cause: unknown,
    detail: Readonly<{
      /** Whether binary commit is known before the reported integration failure. */
      committed: boolean;
    }>
  ) => void;
  /** Optional post-binary-commit metadata integration; must be durably idempotent by tenant and session. */
  onCommitted?: (
    identity: UploadIdentity,
    sessionId: string,
    info: FileInfo
  ) => Promise<{
    /** Validated postcommit catalog asset reference. */
    assetId: string; /** Validated immutable postcommit catalog version reference. */
    versionId: string;
  }>;
}
/** Project tenant-authorized journal state without provider upload IDs, private addresses or native ETags.
 * @param {UploadSession} session - Files-owned authorized journal record.
 * @param {number} partBytes - Configured planned byte size used by the explicit browser protocol.
 * @returns {object} Inert V1 protocol facts and verified part digests.
 */
function sessionView(session: UploadSession, partBytes: number) {
  return {
    protocol: 'zerux-media-resumable-v1',
    id: session.id,
    status: session.status,
    size: session.size,
    sha256: session.sha256,
    expiresAt: session.expiresAt,
    partBytes,
    parts: session.parts.map(({ number, size, sha256 }) => ({
      number,
      size,
      sha256,
    })),
  };
}
/** Own bounded Fetch dispatch over a borrowed tenant-bound files journal. No server, route or background task starts here; host routing/authentication/CSRF remain explicit.
 * @param {MediaResumableOptions} options - Required mount, verified identity, destination/MIME policy and optional postcommit integration.
 * @returns {object} Request handler plus awaited close; close drains requests without abandoning persistent sessions.
 */
export function createMediaResumableHandler(options: MediaResumableOptions) {
  if (
    !options ||
    typeof options.uploads?.initiate !== 'function' ||
    typeof options.identify !== 'function' ||
    typeof options.authorizeRequest !== 'function' ||
    typeof options.destination !== 'function' ||
    !/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(options.prefix) ||
    !Array.isArray(options.allowedTypes) ||
    !options.allowedTypes.length ||
    options.allowedTypes.length > 100 ||
    options.allowedTypes.some(
      (v) => typeof v !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(v)
    )
  ) {
    throw new TypeError('Explicit resumable protocol configuration required');
  }
  /** Validated planned part size; journal/provider constraints remain authoritative. */
  const partBytes = options.partBytes ?? 5 * 1024 * 1024;
  /** Validated complete upload ceiling checked before session initiation. */
  const maxBytes = options.maxBytes ?? 1024 * 1024 * 1024;
  /** Validated process-local admitted request ceiling, default eight and maximum 64. */
  const maxPending = options.maxPending ?? 8;
  if (
    !Number.isSafeInteger(partBytes) ||
    partBytes < 1 ||
    partBytes > 64 * 1024 * 1024 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    !Number.isSafeInteger(maxPending) ||
    maxPending < 1 ||
    maxPending > 64
  ) {
    throw new TypeError('Invalid resumable protocol limits');
  }
  /** Actually unsettled dispatch promises, retained through body cleanup. */
  const pending = new Set<Promise<unknown>>();
  let closed = false;
  /** Create a private noncacheable JSON protocol response with fixed security headers.
   * @param {unknown} body - Inert protocol facts, never private causes or provider credentials.
   * @param {number} [status] - Fixed HTTP status, default 200.
   * @returns {Response} Private JSON response; no background work is started.
   */
  const reply = (body: unknown, status = 200) =>
    Response.json(body, {
      status,
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  /** Decode a bounded 8 KiB UTF-8 JSON object and reject fields outside the operation allowlist. Content is data only and is never evaluated.
   * @param {Request} request - Raw JSON POST/PUT request; body reader cleanup belongs to the raw-body helper.
   * @param {readonly string[]} keys - Fixed allowed fields for this protocol operation.
   * @returns {Promise<any>} Parsed bounded object; shape/value validation follows before dispatch.
   */
  async function json(request: Request, keys: readonly string[]) {
    if (
      request.headers.get('content-type')?.split(';')[0].trim() !==
      'application/json'
    ) {
      throw new TypeError('JSON required');
    }
    /** Lazy counted raw-byte source bounded before parsing or part dispatch. */
    const body = mediaRequestBody(request, { maxBytes: 8192 });
    /** Operation-local bounded JSON chunks, never evaluated as source code. */
    const pieces: Uint8Array[] = [];
    let total = 0;
    // The raw-body helper enforces byte/chunk limits and releases its reader on failure.
    for await (const chunk of body.source) {
      total += chunk.length;
      pieces.push(chunk);
    }
    /** Exact JSON byte buffer assembled only after the 8 KiB input budget is enforced. */
    const bytes = new Uint8Array(total);
    let offset = 0;
    // Assemble the bounded JSON body without evaluating any discovered source text.
    for (const chunk of pieces) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    /** Decoded object checked against the fixed per-operation field allowlist. */
    const value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    );
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !keys.includes(key))
    ) {
      throw new TypeError('Invalid protocol fields');
    }
    return value;
  }
  /** Apply fresh host policy on every request, then invoke only the corresponding tenant-journal operation. Unknown completion is explicit and never retried automatically.
   * @param {Request} request - Borrowed initiating Fetch request; body cancellation runs in finally.
   * @returns {Promise<Response>} Private sanitized protocol outcome, preserving committed-versus-uncertain distinction.
   */
  async function dispatch(request: Request) {
    let committed = false;
    try {
      if ((await options.authorizeRequest(request)) !== true) {
        return reply({ code: 'FORBIDDEN' }, 403);
      }
      /** Server-verified initiating tenant/subject, rechecked for each journal operation. */
      const identity = await options.identify(request);
      /** Parsed request pathname only; queries cannot select upload sessions or destinations. */
      const path = new URL(request.url).pathname;
      if (path !== options.prefix && !path.startsWith(options.prefix + '/')) {
        return reply({ code: 'NOT_FOUND' }, 404);
      }
      /** Path portion relative to the explicit host mount. */
      const suffix = path.slice(options.prefix.length);
      /** Restricted opaque session/operation/part path match; no arbitrary filesystem paths. */
      const match =
        /^\/([a-f0-9]{48})(?:\/(complete)|\/parts\/([1-9][0-9]{0,3}))?$/.exec(
          suffix
        );
      if (suffix === '' && request.method === 'POST') {
        /** Bounded protocol object whose operation-specific values are validated before use. */
        const input = await json(request, [
          'name',
          'size',
          'sha256',
          'contentType',
        ]);

        if (
          typeof input.name !== 'string' ||
          !input.name ||
          input.name.length > 180 ||
          // eslint-disable-next-line no-control-regex -- Intentionally reject or replace control characters in validated media input.
          /[\\/\x00-\x1f\x7f]/.test(input.name) ||
          !Number.isSafeInteger(input.size) ||
          input.size < 1 ||
          input.size > maxBytes ||
          typeof input.sha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(input.sha256) ||
          !options.allowedTypes.includes(input.contentType)
        ) {
          throw new TypeError('Invalid initiation');
        }
        /** Trusted destination selected from verified identity and validated upload facts. */
        const address = options.destination({ ...identity }, input);
        /** Tenant-bound durable journal receipt, projected without native provider secrets. */
        const session = await options.uploads.initiate(identity, address, {
          size: input.size,
          sha256: input.sha256,
          contentType: input.contentType,
          metadata: { 'media-name': input.name },
          ifNoneMatch: true,
          visibility: 'private',
        });
        return reply(sessionView(session, partBytes), 201);
      }
      if (!match) {
        return reply({ code: 'NOT_FOUND' }, 404);
      }
      /** Opaque session reference; files independently checks initiating identity and session state. */
      const id = match[1];
      if (!match[2] && !match[3] && request.method === 'GET') {
        return reply(
          sessionView(await options.uploads.listParts(identity, id), partBytes)
        );
      }
      if (!match[2] && !match[3] && request.method === 'DELETE') {
        await options.uploads.abort(identity, id);
        return reply({ id, status: 'aborted' });
      }
      if (match[3] && request.method === 'PUT') {
        /** Declared positive part byte count checked against the deterministic part plan. */
        const rawSize = request.headers.get('x-media-part-size');
        /** Declared lowercase part digest verified by the files coordinator before acceptance. */
        const sha256 = request.headers.get('x-media-part-sha256');
        if (
          !rawSize ||
          !/^[1-9][0-9]{0,9}$/.test(rawSize) ||
          !sha256 ||
          !/^[a-f0-9]{64}$/.test(sha256) ||
          Number(rawSize) > partBytes
        ) {
          throw new TypeError('Invalid part declaration');
        }
        /** Current tenant-authorized journal state used for part planning or final receipt. */
        const existing = await options.uploads.listParts(identity, id);
        /** Validated one-based part number from the restricted route syntax. */
        const number = Number(match[3]);
        if (
          Number(rawSize) !==
            Math.min(partBytes, existing.size - (number - 1) * partBytes) ||
          Number(rawSize) < 1
        ) {
          throw new TypeError('Invalid planned part size');
        }
        /** Lazy counted raw-byte source bounded before parsing or part dispatch. */
        const body = mediaRequestBody(request, {
          maxBytes: partBytes,
          expectedBytes: Number(rawSize),
          contentType: 'application/octet-stream',
        });
        /** Verified accepted part facts; native upload IDs and ETags remain private. */
        const receipt = await options.uploads.uploadPart(
          identity,
          id,
          Number(match[3]),
          body.source,
          { size: Number(rawSize), sha256, signal: request.signal }
        );
        return reply({
          number: receipt.number,
          size: receipt.size,
          sha256: receipt.sha256,
        });
      }
      if (match[2] && request.method === 'POST') {
        /** Bounded protocol object whose operation-specific values are validated before use. */
        const input = await json(request, ['parts']);
        if (
          !Array.isArray(input.parts) ||
          !input.parts.length ||
          input.parts.length > 1000 ||
          input.parts.some((v: unknown, i: number) => v !== i + 1)
        ) {
          throw new TypeError('Invalid part order');
        }
        /** Current tenant-authorized journal state used for part planning or final receipt. */
        const existing = await options.uploads.listParts(identity, id);
        /** Committed binary facts; later metadata failure must not be reported as uncommitted. */
        const info = await options.uploads.finalize(
          identity,
          id,
          input.parts,
          request.signal
        );
        committed = true;
        /** Optional host metadata receipt after binary commit; callback may recur on duplicate finalization. */
        const asset = options.onCommitted
          ? await options.onCommitted({ ...identity }, id, info)
          : undefined;
        if (
          asset &&
          (typeof asset.assetId !== 'string' ||
            !/^[\w.:/-]{1,128}$/.test(asset.assetId) ||
            typeof asset.versionId !== 'string' ||
            !/^[a-f0-9]{48}$/.test(asset.versionId))
        ) {
          throw new Error('Invalid committed metadata receipt');
        }
        return reply({
          protocol: 'zerux-media-resumable-v1',
          id,
          status: 'complete',
          size: info.size,
          sha256: existing.sha256,
          ...(asset ? { asset } : {}),
        });
      }
      return reply({ code: 'METHOD_NOT_ALLOWED' }, 405);
    } catch (error) {
      try {
        options.onError?.(error, Object.freeze({ committed }));
      } catch {
        /* Observers do not change the protocol outcome. */
      }
      if (committed) {
        return reply(
          { code: 'METADATA_AFTER_COMMIT_FAILED', committed: true },
          503
        );
      }
      /** Private underlying fixed failure discriminator mapped to a sanitized protocol outcome. */
      const code = (error as { code?: string })?.code;
      if (code === 'UPLOAD_FORBIDDEN' || code === 'FORBIDDEN') {
        return reply({ code: 'FORBIDDEN' }, 403);
      }
      if (code === 'UPLOAD_EXPIRED') {
        return reply({ code: 'UPLOAD_EXPIRED' }, 410);
      }
      if (code === 'ENOENT') {
        return reply({ code: 'NOT_FOUND' }, 404);
      }
      if (
        code === 'UPLOAD_BUSY' ||
        code === 'FILE_EXISTS' ||
        code === 'UPLOAD_STATE'
      ) {
        return reply({ code }, 409);
      }
      if (code === 'UPLOAD_UNCERTAIN') {
        return reply({ code, committed: 'unknown' }, 409);
      }
      if (code === 'UPLOAD_LIMIT') {
        return reply({ code: 'UPLOAD_LIMIT' }, 413);
      }
      if (
        code === 'UPLOAD_INTEGRITY' ||
        code === 'UPLOAD_LENGTH' ||
        code === 'UPLOAD_PART_CONFLICT' ||
        code === 'UPLOAD_PART_ORDER' ||
        error instanceof TypeError ||
        error instanceof SyntaxError ||
        error instanceof RangeError
      ) {
        return reply({ code: 'INVALID_UPLOAD' }, 400);
      }
      return reply({ code: 'UPLOAD_FAILED' }, 503);
    } finally {
      await request.body?.cancel().catch(() => {});
    }
  }
  return {
    /** Admit one request within the local pending ceiling; retain capacity through actual dispatch/body cleanup.
     * @param {Request} request - Host-routed request for the configured mount.
     * @returns {Promise<Response>} Protocol response, or private busy/closed response before dispatch.
     */
    handle(request: Request) {
      if (closed) {
        return Promise.resolve(reply({ code: 'CLOSED' }, 503));
      }
      if (pending.size >= maxPending) {
        return Promise.resolve(reply({ code: 'BUSY' }, 503));
      }
      /** Single admitted dispatch promise; capacity remains occupied through actual settlement. */
      const work = dispatch(request);
      pending.add(work);
      work.then(
        () => pending.delete(work),
        () => pending.delete(work)
      );
      return work;
    },
    /** Stop admitting requests and await actual dispatch settlement without closing the borrowed journal or deleting sessions.
     * @returns {Promise<void>} Resolves after admitted requests settle; request abort does not mean session abort.
     */
    async close() {
      closed = true;
      await Promise.allSettled([...pending]);
    },
  };
}
