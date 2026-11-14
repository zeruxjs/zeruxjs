import { createConnector } from '@zeruxjs/db-sqlite';
import { createCms } from '@zenixjs/core/cms';
import { createZenixApplication } from 'zenixjs/application';
import { createSqliteSetupStore } from 'zenixjs/setup-store';

// Invoke from a trusted ZeruxJS plugin/entry. Importing this file starts no server.
// Private config must provide real session, CSRF, admission and operator proof policies.
/** Install the explicitly configured CMS and transfer owned cleanup to the application generation.
 * @param {object} api - Trusted ZeruxJS plugin API; not caller-supplied request data.
 * @param {object} options - Validated private host settings and authorization callbacks.
 * @param {string} options.filename - Absolute private SQLite destination.
 * @param {boolean} options.migrate - Explicit schema policy; generated runtime passes false.
 * @param {Function} options.resolveCorePrincipal - Host verification of initiating core identity.
 * @param {Function} options.authorizeMedia - Host media authorization; generated baseline always denies.
 * @param {object} options.applicationOptions - Remaining trusted Zenix application policies.
 * @returns {Promise<object>} Installed CMS application; returned recovery APIs remain trusted operator-only calls.
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
  /** Owned SQLite connector opened only after the host policy was explicitly configured. */
  const database = await createConnector({
    filename,
    driver: 'node',
    busyTimeoutMs: 1000,
  });
  let cms, application;
  /** Release the application before CMS and database; attempt dependent cleanup even after failures.
   * @returns {Promise<void>} Actual cleanup settlement; borrowed host identity services remain host-owned.
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
    /** Borrowed SQLite setup journal using the same explicitly prepared connection. */
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
