import { createConnector } from '@zeruxjs/db-sqlite';
import { createCms } from '@zenixjs/core/cms';
import { createZenixApplication } from 'zenixjs/application';
import { createSqliteSetupStore } from 'zenixjs/setup-store';

// Invoke from a trusted ZeruxJS plugin/entry. Importing this file starts no server.
// Private config must provide real session, CSRF, admission and operator proof policies.
/** Explicitly install a host-policy-configured CMS and transfer dependent cleanup to its generation.
 * @param {object} api - Trusted ZeruxJS plugin API with disposal registration.
 * @param {object} options - Private verified host configuration, never browser claims.
 * @param {string} options.filename - Absolute private SQLite database destination.
 * @param {boolean} options.migrate - Explicit operator schema preparation policy.
 * @param {Function} options.resolveCorePrincipal - Host session/account verification for core access.
 * @param {Function} options.authorizeMedia - Host files/media authorization callback.
 * @param {object} options.applicationOptions - Remaining trusted application authorization/CSRF settings.
 * @returns {Promise<object>} Owned application; borrowed host authentication resources stay host-owned.
 */
export async function registerZenix(
  api,
  {
    filename,
    migrate,
    resolveCorePrincipal,
    authorizeMedia,
    ...applicationOptions
  }
) {
  /** Owned SQLite connector; closes only after application/core cleanup. */
  const database = await createConnector({
    filename,
    driver: 'node',
    busyTimeoutMs: 1000,
  });
  let cms, application;
  /** Drain the application before core and connector even when an earlier close fails.
   * @returns {Promise<void>} Owned cleanup settlement; host auth services stay borrowed.
   */
  const close = async () => {
    try {
      await application?.close();
    } finally {
      try {
        await cms?.close();
      } finally {
        await database.disconnect();
      }
    }
  };
  try {
    cms = await createCms({
      adapter: 'sqlite',
      connection: database,
      migrate,
      resolvePrincipal: resolveCorePrincipal,
      authorizeMedia,
    });
    /** Borrowed persistent setup adapter over the same explicitly prepared connector. */
    const setupStore = createSqliteSetupStore({
      connection: database,
      migrate,
    });
    application = createZenixApplication({
      ...applicationOptions,
      cms,
      setupStore,
    });
    api.onDispose(close);
    application.install(api);
    return application; // recoverSetup is a trusted operator API, not an HTTP route.
  } catch (error) {
    await close();
    throw error;
  }
}
// Example reviewed application options:
// { origin:'https://cms.example.test', basePath:'/cms', entryId:'home',
//   scope:{tenant:'tenantA',site:'siteA'}, publicPrincipal:privateReadOnlyIdentity,
//   authenticate, login, logout, authorize, csrf:{issue,verify},
//   verifySetupSecret, authorizeRecovery, admit }
// Route the returned application through ZeruxJS; no custom listener is created here.
