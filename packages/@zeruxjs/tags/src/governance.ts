import { validateTagProviders, type TagProviderRegistry } from './providers.js';
/** Durable governance is stored inside the same version-CAS document as the draft.
 * A worker can never observe a partial draft/publish transition. */
import type {
  TagContainer,
  TagContainerStore,
  TagRelease,
  TagGovernance,
} from './types.js';
import { validateContainer } from './container.js';

/** Remove server-owned governance and rebuild an independent public definition.
 * @param {TagContainer} input - Validated candidate draft or retained release.
 * @returns {TagContainer} Definition-only snapshot with runtime schema validation.
 */
function snapshot(input: TagContainer): TagContainer {
  /** Independent public definition fields; governance never nests inside a release. */
  const { governance: _unused, ...definition } = input;
  return validateContainer(definition);
}
/** analytics_tag_containers uses a portable SQL TEXT field (MySQL <= 64 KiB).
 * Prune oldest retained releases before updating the CAS row; never prune live. */
const MAX_DOCUMENT_BYTES = 58_000;
/** Validate and prune oldest retained history to the portable document budget while retaining the live final release.
 * @param {TagContainer} document - Candidate single-document CAS envelope, not a separate release table.
 * @returns {TagContainer} Validated bounded document; an oversized live definition still rejects.
 */
function bounded(document: TagContainer): TagContainer {
  /** Validated mutable candidate copy used only to prune retained historical entries. */
  const checked = validateContainer(document);
  // Remove only oldest retained history; the final published snapshot must remain.
  while (
    Buffer.byteLength(JSON.stringify(checked), 'utf8') > MAX_DOCUMENT_BYTES &&
    (checked.governance?.history.length ?? 0) > 1
  ) {
    checked.governance!.history.shift();
  }
  if (Buffer.byteLength(JSON.stringify(checked), 'utf8') > MAX_DOCUMENT_BYTES) {
    throw new RangeError('Tag release document exceeds portable storage limit');
  }
  return checked;
}
/** Represent a legacy definition as initial release one without persisting a migration automatically.
 * @param {TagContainer} input - Existing validated definition without historical evidence.
 * @returns {TagGovernance} Initial governance envelope timestamped by this operation; caller owns persistence.
 */
function initial(input: TagContainer): TagGovernance {
  /** Definition-only initial published snapshot. */
  const base = snapshot(input);
  return {
    release: 1,
    published: base,
    history: [
      {
        id: 1,
        at: new Date().toISOString(),
        action: 'initial',
        container: base,
      },
    ],
  };
}
/** Append an immutable publication snapshot, retaining at most twelve releases.
 * @param {TagGovernance} g - Current validated governance envelope.
 * @param {TagContainer} container - Definition chosen for the new live release.
 * @param {'publish' | 'rollback'} action - Explicit publish or rollback action recorded in retained history.
 * @returns {TagGovernance} New governance envelope; previous release snapshots are not overwritten.
 */
function append(
  g: TagGovernance,
  container: TagContainer,
  action: 'publish' | 'rollback'
): TagGovernance {
  /** New independent immutable-by-convention published definition snapshot. */
  const published = snapshot(container);
  /** Monotonically advanced live release ID distinct from draft revision. */
  const release = g.release + 1;
  /** Content-owned release snapshot plus operation timestamp and declared action. */
  const record: TagRelease = {
    id: release,
    at: new Date().toISOString(),
    action,
    container: published,
  };
  return { release, published, history: [...g.history, record].slice(-12) };
}
/** Read the live definition; legacy documents are treated as release one until a real edit persists governance.
 * @param {TagContainer} document - Untrusted loaded envelope validated before selecting live content.
 * @returns {TagContainer} Independent validated live snapshot, excluding private governance.
 */
export function publishedContainer(document: TagContainer): TagContainer {
  /** Validated input before reporting live or revision metadata. */
  const parsed = validateContainer(document);
  return snapshot(parsed.governance?.published ?? parsed);
}
/** Summarize draft/live revision and bounded retained history without exposing full definitions.
 * @param {TagContainer} document - Loaded versioned document validated before deriving metadata.
 * @returns {object} Revision/release comparison and retained timestamps/actions; not proof of remote delivery.
 */
export function releaseSummary(document: TagContainer) {
  /** Validated input before reporting live or revision metadata. */
  const parsed = validateContainer(document);
  /** Existing governance or an operation-local legacy initial envelope. */
  const g = parsed.governance ?? initial(parsed);
  return {
    draftRevision: parsed.version,
    publishedRelease: g.release,
    publishedRevision: g.published.version,
    unpublishedChanges:
      JSON.stringify(snapshot(parsed)) !== JSON.stringify(g.published),
    history: g.history.map(({ id, at, action, container }) => ({
      id,
      at,
      action,
      revision: container.version,
    })),
  };
}
/** CAS-save a next draft while preserving server-owned live/history data. This low-level helper does not authorize HTTP callers.
 * @param {TagContainerStore} store - Borrowed host store with atomic whole-document expected-version checks.
 * @param {TagContainer} next - Next public draft, required to advance exactly one revision.
 * @param {number} expectedVersion - Current optimistic revision; stale or cross-container proposals return false.
 * @param {TagProviderRegistry} registry - Borrowed explicit custom-provider schema registry when needed.
 * @returns {Promise<boolean>} True for the store-reported CAS success, false for conflict; storage failures propagate without retry.
 */
export async function saveTagDraft(
  store: TagContainerStore,
  next: TagContainer,
  expectedVersion: number,
  registry?: TagProviderRegistry
): Promise<boolean> {
  validateTagProviders(next, registry);
  /** Validated current borrowed-store state; CAS still rechecks the revision at commit. */
  const current = validateContainer(await store.load());
  if (
    current.version !== expectedVersion ||
    next.version !== expectedVersion + 1 ||
    next.id !== current.id
  ) {
    return false;
  }
  // Governance is server-controlled; ignore any metadata sent by the editor.
  return store.save(
    bounded({
      ...snapshot(next),
      governance: current.governance ?? initial(current),
    }),
    expectedVersion
  );
}
/** Validate providers and CAS-promote the current draft as a new immutable live release. Host authorization/destination checks remain mandatory.
 * @param {TagContainerStore} store - Borrowed atomic versioned document store.
 * @param {number} expectedVersion - Required current draft revision.
 * @param {TagProviderRegistry} registry - Borrowed custom-provider schema registry.
 * @returns {Promise<boolean>} Store-reported committed CAS outcome; no automatic retry of ambiguous failures.
 */
export async function publishTagDraft(
  store: TagContainerStore,
  expectedVersion: number,
  registry?: TagProviderRegistry
): Promise<boolean> {
  /** Validated current borrowed-store state; CAS still rechecks the revision at commit. */
  const current = validateContainer(await store.load());
  if (current.version !== expectedVersion) {
    return false;
  }
  validateTagProviders(current, registry);
  /** New retained release envelope prepared before a single-document CAS. */
  const governance = append(
    current.governance ?? initial(current),
    current,
    'publish'
  );
  return store.save(
    bounded({ ...current, version: current.version + 1, governance }),
    expectedVersion
  );
}
/** CAS-publish a retained historical snapshot as a new release while preserving the current draft.
 * @param {TagContainerStore} store - Borrowed atomic versioned document store.
 * @param {number} expectedVersion - Required current draft revision.
 * @param {number} releaseId - Existing retained release ID; evicted history rejects.
 * @param {TagProviderRegistry} registry - Borrowed provider registry rechecking retained schema compatibility.
 * @returns {Promise<boolean>} CAS success or stale conflict; this helper grants no publisher permission.
 */
export async function rollbackTagRelease(
  store: TagContainerStore,
  expectedVersion: number,
  releaseId: number,
  registry?: TagProviderRegistry
): Promise<boolean> {
  /** Validated current borrowed-store state; CAS still rechecks the revision at commit. */
  const current = validateContainer(await store.load());
  if (current.version !== expectedVersion) {
    return false;
  }
  /** New retained release envelope prepared before a single-document CAS. */
  const governance = current.governance ?? initial(current);
  /** Retained historical release selected by explicit ID, never a guessed draft. */
  const entry = governance.history.find((item) => item.id === releaseId);
  if (!entry) {
    throw new RangeError('Release not available in retained history');
  }
  validateTagProviders(entry.container, registry);
  /** Rollback envelope appending a new release while retaining current draft content. */
  const updated = append(governance, entry.container, 'rollback');
  return store.save(
    bounded({ ...current, version: current.version + 1, governance: updated }),
    expectedVersion
  );
}
