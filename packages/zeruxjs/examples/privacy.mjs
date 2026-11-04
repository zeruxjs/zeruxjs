import { createPrivacyCoordinator, privacyCsvCell } from 'zeruxjs/privacy';

// All persistence/adapters are private, explicitly injected host implementations.
// resolveSubject verifies account linkage/proof; it must not look up an email alone.
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
export async function previewOnePage(coordinator, verifiedProof, principal) {
  const job = await coordinator.create('erase', verifiedProof, principal);
  return coordinator.preview({ tenant: job.tenant, id: job.id }, principal);
  // Continue preview until phase==='approval', show counts/holds/outside coverage,
  // then separately approve with verified evidence. No deletion occurs above.
}

export async function downloadExport(
  coordinator,
  reference,
  principal,
  write,
  signal,
) {
  // Serve only behind host authorization with private,no-store, attachment disposition,
  // application/x-ndjson and nosniff. Never expose an object-store URL.
  for await (const chunk of coordinator.download(reference, principal, {
    signal,
  })) {
    await write(chunk); // await the response layer's backpressure
  }
}

export const csvExample = () =>
  privacyCsvCell('=untrusted spreadsheet formula');
// Await coordinator.close() before closing borrowed stores/dependent services.
