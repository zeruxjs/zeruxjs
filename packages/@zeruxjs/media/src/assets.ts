import type {
  createAssetStorage,
  AssetIdentity,
  AssetStorageInput,
  AssetRepairCandidate,
  StoredAssetVersion,
} from '@zeruxjs/asset-manager/storage';
import type { FileAddress } from '@zeruxjs/files';
import { mediaRequestBody } from './request-body.js';
export interface MediaAssetOptions {
  /** Borrowed asset-storage adapter; this service never closes it. */
  assets: ReturnType<typeof createAssetStorage>;
  /** Must authenticate server identity; never copy unverified forwarded/header tenant claims. */
  identify: (request: Request) => AssetIdentity | Promise<AssetIdentity>;
  /** Required host request policy; only literal true permits identity resolution. */
  authorizeRequest: (request: Request) => boolean | Promise<boolean>;
  /** Process-local admitted operation ceiling, default 4 and maximum 64. */
  maxPending?: number;
}
/** Project safe version facts without storage addresses, arbitrary catalog metadata or signed access URLs.
 * @param {StoredAssetVersion} version - Authorized catalog version returned by the borrowed storage adapter.
 * @returns {object} Inert public projection; the caller still controls response privacy.
 */
function publicMetadata(version: StoredAssetVersion) {
  /** Authorized catalog/version facts projected without private addresses or arbitrary metadata. */
  const { asset, reference, retired } = version;
  return {
    assetId: asset.id,
    versionId: reference.versionId,
    name: asset.name,
    type: asset.type,
    size: reference.size,
    sha256: reference.sha256,
    contentType: reference.contentType,
    retired,
    variants: Object.keys(asset.variants ?? {}),
  };
}
/** Own bounded media/catalog operation admission over a borrowed asset adapter. Close stops admission and drains actual settlement without aborting active work or closing dependencies.
 * @param {MediaAssetOptions} options - Borrowed storage, verified identity, request authorization and pending ceiling.
 * @returns {object} Explicit upload/register/download/repair operations and an awaited close handle.
 */
export function createMediaAssetService(options: MediaAssetOptions) {
  if (
    !options ||
    typeof options.identify !== 'function' ||
    typeof options.authorizeRequest !== 'function' ||
    typeof options.assets?.upload !== 'function'
  ) {
    throw new TypeError('Injected asset storage and identity required');
  }
  /** Borrowed adapter; admission/drain ownership does not transfer dependency ownership. */
  const assets = options.assets;
  /** Validated process-local operation ceiling, default four and at most 64. */
  const maxPending = options.maxPending ?? 4;
  if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 64) {
    throw new TypeError('Invalid pending limit');
  }
  /** Actually unsettled admitted promises; caller cancellation alone does not release capacity. */
  const pending = new Set<Promise<unknown>>();
  let closed = false;
  /** Reserve process-local capacity until the operation actually settles; never retry side effects automatically.
   * @param {function} fn - Authorized operation invoked in a promise turn after admission.
   * @returns {Promise<T>} Original operation outcome; closed/busy calls reject before invocation.
   */
  function run<T>(fn: () => Promise<T>) {
    if (closed) {
      return Promise.reject(new Error('Media asset service closed'));
    }
    if (pending.size >= maxPending) {
      return Promise.reject(new Error('Media asset service busy'));
    }
    /** Single admitted operation promise; settlement releases exactly its own capacity slot. */
    const work = Promise.resolve().then(fn);
    pending.add(work);
    work.then(
      () => pending.delete(work),
      () => pending.delete(work)
    );
    return work;
  }
  /** Require literal true request authorization before obtaining the host-verified identity.
   * @param {Request} request - Borrowed initiating request; identity must not come from unverified role/tenant claims.
   * @returns {Promise<AssetIdentity>} Verified host identity; catalog operations independently authorize it.
   */
  async function identify(request: Request) {
    if ((await options.authorizeRequest(request)) !== true) {
      throw Object.assign(new Error('Media request forbidden'), {
        code: 'FORBIDDEN',
      });
    }
    return options.identify(request);
  }
  return {
    /** Authorize and stream raw bytes through storage integrity checks before registering metadata. Failure cancels any unconsumed request body; no blind compensating deletion is attempted.
     * @param {Request} request - Host-authenticated raw POST/PUT request.
     * @param {AssetStorageInput} input - Validated catalog/storage facts including expected bytes, MIME and digest.
     * @returns {Promise<object>} Safe committed version facts; partial storage/catalog failures retain adapter repair semantics.
     */
    upload(request: Request, input: AssetStorageInput) {
      return run(async () => {
        try {
          /** Host-verified principal/tenant after required request authorization. */
          const identity = await identify(request);
          /** Bounded lazy raw-body source with exact expected length and MIME metadata. */
          const body = mediaRequestBody(request, {
            maxBytes: input.size || 1,
            expectedBytes: input.size,
            contentType: input.contentType,
          });
          return publicMetadata(
            await assets.upload(identity, input, body.source, request.signal)
          );
        } catch (error) {
          await request.body?.cancel().catch(() => {});
          throw error;
        }
      });
    },
    /** Register existing bytes as borrowed storage after POST and authorization checks.
     * @param {Request} request - Host-authenticated POST request.
     * @param {AssetStorageInput} input - Expected catalog/storage integrity facts.
     * @param {FileAddress} address - Host-authorized existing object address, not a public access URL.
     * @returns {Promise<object>} Safe committed version facts; this does not transfer binary ownership implicitly.
     */
    register(request: Request, input: AssetStorageInput, address: FileAddress) {
      return run(async () => {
        if (request.method !== 'POST') {
          throw new TypeError('Registration requires POST');
        }
        return publicMetadata(
          await assets.register(
            await identify(request),
            input,
            address,
            request.signal
          )
        );
      });
    },
    /** Return sanitized authorized versions for an asset, omitting private storage details.
     * @param {Request} request - Host-authenticated request; host routing owns method policy.
     * @param {string} assetId - Catalog asset identifier under the verified identity.
     * @returns {Promise<object[]>} Projected authorized version history.
     */
    metadata(request: Request, assetId: string) {
      return run(async () =>
        (await assets.versions(await identify(request), assetId)).map(
          publicMetadata
        )
      );
    },
    /** Download one active authorized version through the bounded full-integrity path, including verification for HEAD.
     * @param {Request} request - GET/HEAD request with host authentication.
     * @param {string} assetId - Authorized catalog asset identifier.
     * @param {string} versionId - Immutable version reference belonging to the requested asset.
     * @returns {Promise<Response>} Private attachment, 404 or 405; full bytes are buffered before success.
     */
    download(request: Request, assetId: string, versionId: string) {
      return run(async () => {
        if (!['GET', 'HEAD'].includes(request.method)) {
          return new Response(null, {
            status: 405,
            headers: { Allow: 'GET, HEAD' },
          });
        }
        /** Host-verified principal/tenant after required request authorization. */
        const identity = await identify(request);
        /** Requested active immutable version within the already authorized asset history. */
        const version = (await assets.versions(identity, assetId)).find(
          (v) => v.reference.versionId === versionId && !v.retired
        );
        if (!version) {
          return new Response('Not found', { status: 404 });
        }
        // This path is deliberately bounded/verified; use files-backed streaming for larger transfers.
        /** Complete bounded verified binary payload; larger streams belong to the files path. */
        const bytes = await assets.download(
          identity,
          versionId,
          request.signal
        );

        /** Inert attachment display name; path/control characters cannot choose storage destinations. */
        const name =
          version.asset.name
            // eslint-disable-next-line no-control-regex -- Intentionally reject or replace control characters in validated media input.
            .replace(/[\\/\x00-\x1f\x7f"']/g, '_')
            .slice(0, 180) || 'download';
        return new Response(
          request.method === 'HEAD' ? null : new Uint8Array(bytes),
          {
            headers: {
              'Content-Type': version.reference.contentType,
              'Content-Length': String(bytes.byteLength),
              'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
              'Cache-Control': 'private, no-store',
              'X-Content-Type-Options': 'nosniff',
              'X-Media-SHA256': version.reference.sha256,
            },
          }
        );
      });
    },
    /** Require DELETE plus independent catalog authorization and optional revision before retiring/deleting the selected version.
     * @param {Request} request - Host-authenticated DELETE request.
     * @param {string} versionId - Immutable version reference.
     * @param {object} input - Explicit binary ownership decision and optional expected revision.
     * @param {boolean} input.binary - Whether the adapter should remove owned bytes.
     * @param {number} [input.expectedRevision] - Expected catalog revision for conflict checks.
     * @returns {Promise<unknown>} Borrowed adapter deletion receipt; failures do not imply atomic cross-store rollback.
     */
    remove(
      request: Request,
      versionId: string,
      input: {
        /** Explicit decision to delete owned binary bytes as well as metadata references. */
        binary: boolean;
        /** Optional catalog revision for conflict detection; not a distributed lock. */
        expectedRevision?: number;
      }
    ) {
      return run(async () => {
        if (request.method !== 'DELETE') {
          throw new TypeError('Removal requires DELETE');
        }
        return assets.delete(await identify(request), versionId, input);
      });
    },
    /** List authorized orphan candidates without deleting them. Candidate addresses are private operator data and must not be exposed as public metadata.
     * @param {Request} request - Host-authenticated privileged request.
     * @param {object} input - Bounded repair page request, default adapter pagination.
     * @param {string} [input.cursor] - Opaque private repair continuation.
     * @param {number} [input.limit] - Adapter-bounded preview page size.
     * @returns {Promise<unknown>} Private adapter repair preview, not approval to delete.
     */
    previewRepair(
      request: Request,
      input: {
        /** Opaque adapter repair continuation, scoped by verified identity. */
        cursor?: string; /** Adapter-bounded repair preview page size. */
        limit?: number;
      } = {}
    ) {
      return run(async () =>
        assets.previewRepair(await identify(request), input)
      );
    },
    /** Require POST and privileged adapter approval for explicit previously reviewed repair candidates.
     * @param {Request} request - Host-authenticated privileged POST request.
     * @param {readonly AssetRepairCandidate[]} candidates - Reviewed revision-bound candidates; never inferred bucket-wide deletion.
     * @returns {Promise<unknown>} Adapter repair outcomes, with independent permission and conflict checks.
     */
    repair(request: Request, candidates: readonly AssetRepairCandidate[]) {
      return run(async () => {
        if (request.method !== 'POST') {
          throw new TypeError('Repair requires POST');
        }
        return assets.repair(await identify(request), candidates);
      });
    },
    /** Stop admission and await all currently admitted work; borrowed assets/files and request signals remain host-owned.
     * @returns {Promise<void>} Settles after admitted operations settle, without forced JavaScript cancellation.
     */
    async close() {
      closed = true;
      await Promise.allSettled([...pending]);
    },
  };
}
