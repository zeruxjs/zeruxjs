import { createConnector } from '@zeruxjs/db-sqlite';
import { createCms } from '@zenixjs/core/cms';
import { createSqliteSetupStore } from 'zenixjs/setup-store';
import { loadSettings } from '../src/settings.mjs';
// Separate operator action; never run from generation/build or an HTTP request.
if (process.argv.length !== 3 || process.argv[2] !== '--approve') {
  throw Error(
    'Review backups and schema, then explicitly run npm run migrate -- --approve'
  );
}
/** Explicit private database destination from validated host environment. */
const { filename } = loadSettings();
/** Owned operator-only SQLite connection; finally releases it even when schema work fails. */
const database = await createConnector({
  filename,
  driver: 'node',
  busyTimeoutMs: 1000,
});
let cms;
try {
  cms = await createCms({
    adapter: 'sqlite',
    connection: database,
    migrate: true,
    resolvePrincipal: async () => null,
    authorizeMedia: async () => false,
  });
  createSqliteSetupStore({ connection: database, migrate: true });
  console.log(
    'CMS and setup schema initialized; no account, site or content created.'
  );
} finally {
  try {
    await cms?.close();
  } finally {
    await database.disconnect();
  }
}
