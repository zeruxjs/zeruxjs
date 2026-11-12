import type {
  Asset,
  AssetFilter,
  AssetSnapshot,
  AssetOperation,
} from './types.js';
import { validateAsset } from './validation.js';
import { resolveAssetVariant } from './variants.js';

/** Fixed-message optimistic revision conflict; no implicit retry or overwrite. */
export class AssetRevisionError extends Error {
  /** Create an asset revision conflict with a fixed public message.
   */
  constructor() {
    super('Asset catalog revision conflict');
    this.name = 'AssetRevisionError';
  }
}
/** Standalone process-local metadata owner with detached reads and atomic staged batches. */
export class AssetManager {
  /** Validated asset copies owned only by this catalog. */
  private readonly assets = new Map<string, Asset>();
  /** Monotonic local mutation revision; not a distributed lock. */
  private sequence = 0;
  /** Read the current local optimistic revision.
   * @returns {number} Current mutation sequence.
   */
  get revision(): number {
    return this.sequence;
  }
  /** Read the number of current metadata records.
   * @returns {number} Current map size.
   */
  get size(): number {
    return this.assets.size;
  }
  /** Validate and upsert one detached asset, preserving the legacy overwrite contract.
   * @param {Asset} asset - Complete candidate; binary data is not fetched.
   * @returns {Asset} Defensive copy after a single local revision increment.
   */
  add(asset: Asset): Asset {
    /** Validated detached asset; callers cannot mutate catalog storage through returned values. */
    const copy = validateAsset(asset);
    this.assets.set(copy.id, copy);
    this.sequence++;
    return structuredClone(copy);
  }
  /** Stage every supplied asset before publishing one local catalog mutation.
   * @param {Iterable<Asset>} assets - Finite host-controlled iterable of complete assets.
   * @returns {void} Invalid assets reject the entire batch; legacy add behavior remains upsert.
   */
  addMany(assets: Iterable<Asset>): void {
    this.apply([...assets].map((asset) => ({ action: 'add' as const, asset })));
  }
  /** Validate the complete merged asset before replacing an existing ID.
   * @param {string} id - Existing logical asset ID.
   * @param {Partial<Omit<Asset, 'id'>>} changes - Partial metadata overrides; ID remains fixed.
   * @returns {Asset} Detached updated record; missing IDs or invalid changes throw.
   */
  update(id: string, changes: Partial<Omit<Asset, 'id'>>): Asset {
    /** Existing staged/current asset required before applying an update. */
    const current = this.assets.get(id);
    if (!current) {
      throw new Error('Asset not found');
    }
    return this.add({ ...current, ...changes, id });
  }
  /** Atomically stage a host-controlled operation iterable with an optional optimistic revision check. This is process-local and does not lock other writers.
   * @param {Iterable<AssetOperation>} operations - Trusted finite sequence of supported operations.
   * @param {number} expectedRevision - Optional exact previous local revision.
   * @returns {number} Current revision after one increment if anything changed; failure preserves the live map.
   */
  apply(
    operations: Iterable<AssetOperation>,
    expectedRevision?: number
  ): number {
    if (expectedRevision !== undefined && expectedRevision !== this.sequence) {
      throw new AssetRevisionError();
    }
    /** Private candidate map; invalid later operations leave the live catalog unchanged. */
    const staging = new Map(this.assets);
    let changed = false;
    // Stage all operations before mutating the live map; one invalid operation aborts publication.
    for (const operation of operations) {
      if (operation.action === 'add') {
        /** Validated candidate asset or separate catalog used for atomic snapshot staging. */
        const next = validateAsset(operation.asset);
        staging.set(next.id, next);
        changed = true;
      } else if (operation.action === 'update') {
        /** Existing staged/current asset required before applying an update. */
        const current = staging.get(operation.id);
        if (!current) {
          throw new Error('Asset not found');
        }
        staging.set(
          operation.id,
          validateAsset({ ...current, ...operation.changes, id: operation.id })
        );
        changed = true;
      } else if (operation.action === 'remove') {
        if (staging.delete(operation.id)) {
          changed = true;
        }
      } else {
        throw new TypeError('Unsupported asset operation');
      }
    }
    if (changed) {
      this.assets.clear();
      // Publish the complete validated candidate as one local revision.
      for (const [id, asset] of staging) {
        this.assets.set(id, asset);
      }
      this.sequence++;
    }
    return this.sequence;
  }
  /** Read one defensive asset copy without authorizing storage access.
   * @param {string} id - Logical asset identifier.
   * @returns {Asset|undefined} Detached record or absence.
   */
  get(id: string): Asset | undefined {
    /** Stored catalog asset copied before being returned to the caller. */
    const value = this.assets.get(id);
    return value ? structuredClone(value) : undefined;
  }
  /** Resolve one explicit registered variant on a detached validated asset.
   * @param {string} id - Logical asset identifier.
   * @param {string} variant - Optional registered variant name.
   * @returns {ReturnType<typeof resolveAssetVariant>|undefined} Resolved record or absent asset; unknown variants throw.
   */
  resolve(
    id: string,
    variant?: string
  ): ReturnType<typeof resolveAssetVariant> | undefined {
    /** Detached source asset resolved before applying a variant override. */
    const asset = this.get(id);
    return asset ? resolveAssetVariant(asset, variant) : undefined;
  }
  /** Check local logical asset presence.
   * @param {string} id - Logical asset identifier.
   * @returns {boolean} Whether the map contains this ID.
   */
  has(id: string): boolean {
    return this.assets.has(id);
  }
  /** Remove current metadata only; binary ownership stays with explicit storage adapters.
   * @param {string} id - Logical asset identifier.
   * @returns {boolean} Whether a record was removed; only successful removal increments revision.
   */
  remove(id: string): boolean {
    /** Whether an existing asset was removed; no-op deletes preserve the revision. */
    const removed = this.assets.delete(id);
    if (removed) {
      this.sequence++;
    }
    return removed;
  }
  /** Clear current metadata as one local revision change when nonempty.
   * @returns {void} No binary deletion or distributed coordination is performed.
   */
  clear(): void {
    if (this.assets.size) {
      this.assets.clear();
      this.sequence++;
    }
  }
  /** Filter and page defensive copies using legacy local matching semantics.
   * @param {AssetFilter} filter - Optional type/tag/substring and pagination settings.
   * @returns {Asset[]} Bounded insertion-ordered result; this is not tenant authorization.
   */
  list(filter: AssetFilter = {}): Asset[] {
    /** Bounded result page size, default/max 10000. */
    const limit = filter.limit ?? 10000;
    /** Nonnegative result offset, default zero. */
    const offset = filter.offset ?? 0;
    if (
      !Number.isSafeInteger(limit) ||
      limit < 0 ||
      limit > 10000 ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    ) {
      throw new RangeError('Invalid pagination');
    }
    /** Optional locale-folded substring query; matching is local and not a tenant boundary. */
    const query = filter.query?.toLocaleLowerCase();
    return [...this.assets.values()]
      .filter(
        (a) =>
          (!filter.type || a.type === filter.type) &&
          (!filter.tag || a.tags?.includes(filter.tag)) &&
          (!query ||
            a.name.toLocaleLowerCase().includes(query) ||
            a.id.toLocaleLowerCase().includes(query) ||
            a.tags?.some((t) => t.toLocaleLowerCase().includes(query)))
      )
      .slice(offset, offset + limit)
      .map((a) => structuredClone(a));
  }
  /** Copy the current catalog into the compatible V1 snapshot shape.
   * @returns {AssetSnapshot} Detached records and current local revision; persistence is explicit.
   */
  snapshot(): AssetSnapshot {
    return {
      version: 1,
      assets: [...this.assets.values()].map((asset) => structuredClone(asset)),
      revision: this.sequence,
    };
  }
  /** Validate a complete V1 snapshot on a separate candidate before replacing live state.
   * @param {AssetSnapshot} snapshot - Untrusted snapshot data with optional nonnegative revision.
   * @returns {void} Invalid/duplicate records leave the previous catalog unchanged.
   */
  load(snapshot: AssetSnapshot): void {
    if (
      !snapshot ||
      snapshot.version !== 1 ||
      !Array.isArray(snapshot.assets) ||
      snapshot.assets.length > 100000 ||
      (snapshot.revision !== undefined &&
        (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0))
    ) {
      throw new TypeError('Unsupported asset snapshot');
    }
    /** Validated candidate asset or separate catalog used for atomic snapshot staging. */
    const next = new AssetManager();
    next.addMany(snapshot.assets);
    if (next.size !== snapshot.assets.length) {
      throw new TypeError('Duplicate asset IDs');
    }
    this.assets.clear();
    // Replace live state only after the separate snapshot candidate is fully valid.
    for (const [id, asset] of next.assets) {
      this.assets.set(id, asset);
    }
    this.sequence = snapshot.revision ?? this.sequence + 1;
  }
  /** Serialize only the current asset array for legacy transfer.
   * @returns {string} Inert JSON data without executable callbacks or snapshot revision.
   */
  export(): string {
    return JSON.stringify(this.snapshot().assets);
  }
  /** Parse and atomically stage a bounded legacy asset array.
   * @param {string} json - Inert JSON array; no source modules are evaluated.
   * @returns {void} Invalid JSON/assets reject without a partial import; upsert semantics remain compatible.
   */
  import(json: string): void {
    /** Inert parsed asset array; addMany validates the complete staged mutation. */
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed) || parsed.length > 100000) {
      throw new TypeError('Expected asset array');
    }
    this.addMany(parsed as Asset[]);
  }
}
/** Create a standalone metadata catalog with no I/O or background resources.
 * @returns {AssetManager} In-memory catalog; no close handle or storage durability.
 */
export function createAssetManager(): AssetManager {
  return new AssetManager();
}
