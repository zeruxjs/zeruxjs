import { createPrivacyCoordinator, privacyCsvCell } from 'zeruxjs/privacy';

// All persistence/adapters are private, explicitly injected host implementations.
// resolveSubject verifies account linkage/proof; it must not look up an email alone.
/** Create an explicitly configured coordinator without starting work or deleting records.
 * @param {object} options - Private host implementations and authorization policies.
 * @param {object} options.store - Host durable checkpoint store.
 * @param {object} options.exports - Host private export store with expiry enforcement.
 * @param {object[]} options.participants - Explicit service participants and their coverage.
 * @param {Function} options.resolveSubject - Verify tenant/account linkage from trusted proof.
 * @param {Function} options.authorize - Recheck initiating principal permissions on each operation.
 * @param {Function} options.approve - Verify explicit approval evidence before destructive work.
 * @param {Function} options.projectExport - Project only portable approved record fields.
 * @returns {ReturnType<typeof createPrivacyCoordinator>} Owned coordinator; close before borrowed stores.
 */
export function startPrivacyOperations({
  store,
  exports,
  participants,
  resolveSubject,
  authorize,
  approve,
  projectExport,
}) {
  return createPrivacyCoordinator({
    policyVersion: 'privacy-policy-v1',
    store,
    exports,
    participants,
    resolveSubject,
    authorize,
    approve,
    projectExport,
    pageSize: 50,
    maxPages: 1000,
    maxExportBytes: 10 * 1024 * 1024,
    jobTtlMs: 86400000,
    exportTtlMs: 3600000,
  });
}

// Host route handlers authenticate and enforce Origin/CSRF before calling these.
/** Create an erasure preview and inspect one bounded page without deleting records.
 * @param {ReturnType<typeof createPrivacyCoordinator>} coordinator - Borrowed authorized coordinator.
 * @param {unknown} verifiedProof - Host-verifiable subject proof, never an email alone.
 * @param {unknown} principal - Server-verified initiating principal.
 * @returns {Promise<object>} Preview checkpoint requiring further preview/approval steps.
 */
export async function previewOnePage(coordinator, verifiedProof, principal) {
  /** Durable preview job bound by the coordinator to the verified subject and tenant. */
  const job = await coordinator.create('erase', verifiedProof, principal);
  return coordinator.preview({ tenant: job.tenant, id: job.id }, principal);
  // Continue preview until phase==='approval', show counts/holds/outside coverage,
  // then separately approve with verified evidence. No deletion occurs above.
}

/** Stream an authorized private export through a backpressured host response writer.
 * @param {ReturnType<typeof createPrivacyCoordinator>} coordinator - Borrowed coordinator.
 * @param {object} reference - Tenant-bound durable job reference.
 * @param {unknown} principal - Server-verified principal, reauthorized for download.
 * @param {Function} write - Host writer returning its actual backpressure settlement.
 * @param {AbortSignal} signal - Request cancellation owned by the response layer.
 * @returns {Promise<void>} Download settlement; expiry or access failure rejects.
 */
export async function downloadExport(
  coordinator,
  reference,
  principal,
  write,
  signal
) {
  // Serve only behind host authorization with private,no-store, attachment disposition,
  // application/x-ndjson and nosniff. Never expose an object-store URL.
  for await (const chunk of coordinator.download(reference, principal, {
    signal,
  })) {
    await write(chunk); // await the response layer's backpressure
  }
}

/** Demonstrate formula-safe spreadsheet projection without exporting private records.
 * @returns {string} Escaped synthetic cell value.
 */
export const csvExample = () =>
  privacyCsvCell('=untrusted spreadsheet formula');
// Await coordinator.close() before closing borrowed stores/dependent services.
