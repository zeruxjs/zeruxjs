import { createCms } from '@zenixjs/core/cms';

// Called by trusted server startup. The filename and migration approval are config,
// never HTTP input. No connection is opened just by importing this example.
export async function openContentCore({
  filename,
  migrate,
  resolvePrincipal,
  authorizeMedia,
}) {
  return createCms({
    adapter: 'sqlite',
    filename,
    migrate,
    resolvePrincipal,
    authorizeMedia,
  });
}

// Host authenticates this session on every operation via resolvePrincipal.
// Its verified TenantPrincipal needs this tenant/site in its explicit allowlist.
export async function createFirstArticle(cms, scope, serverSession) {
  await cms.createSite(scope, 'Example site', serverSession);
  await cms.registerContentType(
    scope,
    {
      id: 'article',
      version: 1,
      fields: { title: { kind: 'text', required: true, maxLength: 200 } },
    },
    serverSession,
  );
  const saved = await cms.saveDraft(
    scope,
    'welcome',
    null,
    {
      type: 'article',
      typeVersion: 1,
      values: { title: 'Welcome' },
    },
    serverSession,
  );
  return cms.publish(scope, saved.entry.id, saved.entry.head, serverSession);
}
// Await cms.close() during generation shutdown before closing borrowed dependencies.
// These are separate commits: startup/sample helpers are not a distributed transaction.
