import { createConnector } from '@zeruxjs/db-sqlite';
import { createCms } from '@zenixjs/core/cms';
import { createZenixApplication } from 'zenixjs/application';
import { createSqliteSetupStore } from 'zenixjs/setup-store';

// Invoke from a trusted ZeruxJS plugin/entry. Importing this file starts no server.
// Private config must provide real session, CSRF, admission and operator proof policies.
export async function registerZenix(
  api,
  {
    filename,
    migrate,
    resolveCorePrincipal,
    authorizeMedia,
    ...applicationOptions
  },
) {
  const database = await createConnector({
    filename,
    driver: 'node',
    busyTimeoutMs: 1000,
  });
  let cms, application;
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
