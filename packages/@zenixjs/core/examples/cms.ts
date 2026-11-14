import { createCms } from '@zenixjs/core/cms';

// Called by trusted server startup. The filename and migration approval are config,
// never HTTP input. No connection is opened just by importing this example.
/** Open a trusted host-configured CMS instance; importing this example is inert.
 * @param {object} options - Trusted host settings passed explicitly at startup.
 * @param {string} options.filename - Private SQLite path; no user-selected URLs or filenames.
 * @param {boolean} [options.migrate] - Explicit startup migration approval; omission verifies existing schema.
 * @param {import("@zenixjs/core/cms").CmsOptions["resolvePrincipal"]} options.resolvePrincipal - Host-owned fresh session verification.
 * @param {import("@zenixjs/core/cms").CmsOptions["authorizeMedia"]} options.authorizeMedia - Host-owned files access/version/hash verification.
 * @returns {Promise<import("@zenixjs/core/cms").Cms>} Owned CMS instance; the host must await close before its borrowed dependencies.
 * @throws {Error} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
 */
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
/** Create and publish one example article through separate authorized domain operations.
 * @param {import("@zenixjs/core/cms").Cms} cms - Borrowed domain instance; this helper does not close it.
 * @param {CmsScope} scope - Host-selected tenant/site boundary; no permission is inferred from its syntax.
 * @param {unknown} serverSession - Host-owned authenticated session/proof checked on every domain operation.
 * @returns {Promise<{entry: import("@zenixjs/core/cms").CmsEntry, revision: import("@zenixjs/core/cms").CmsRevision}>} Published receipt; earlier successful setup operations are not rolled back if a later one fails.
 * @throws {Error} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
 */
export async function createFirstArticle(cms, scope, serverSession) {
  await cms.createSite(scope, 'Example site', serverSession);
  await cms.registerContentType(
    scope,
    {
      id: 'article',
      version: 1,
      fields: { title: { kind: 'text', required: true, maxLength: 200 } },
    },
    serverSession
  );
  /** Committed draft receipt; publish is a separate authorized operation, not an atomic bootstrap batch. */
  const saved = await cms.saveDraft(
    scope,
    'welcome',
    null,
    {
      type: 'article',
      typeVersion: 1,
      values: { title: 'Welcome' },
    },
    serverSession
  );
  return cms.publish(scope, saved.entry.id, saved.entry.head, serverSession);
}
// Await cms.close() during generation shutdown before closing borrowed dependencies.
// These are separate commits: startup/sample helpers are not a distributed transaction.
