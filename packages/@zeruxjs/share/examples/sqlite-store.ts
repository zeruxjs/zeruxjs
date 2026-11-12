import type { SqliteConnector } from '@zeruxjs/db-sqlite';
import { createSqliteShortLinkStore } from '@zeruxjs/share/sqlite';
import type { ShortLinkOptions } from '@zeruxjs/share/server';
import { configureLinks } from './short-links.js';

/** Configure links over a borrowed native connector on a host-qualified persistent file.
 * @param {SqliteConnector} database - Writable persistent connector; never use :memory: for this contract.
 * @param {ShortLinkOptions['authorize']} authorize - Fresh host session/tenant authorization.
 * @param {boolean} initialize - Explicit schema provisioning opt-in; defaults false.
 * @returns {object} Owned service; close before disconnecting the borrowed database.
 */
export function configureSqliteLinks(
  database: SqliteConnector,
  authorize: ShortLinkOptions['authorize'],
  initialize = false
) {
  /** Borrowed-connector adapter; it owns neither database connection nor schema migrations. */
  const store = createSqliteShortLinkStore({
    database,
    persistent: true,
    initialize,
  });
  return configureLinks(store, authorize);
}
// Initialize only when deliberately provisioning the host-owned share_short_links table.
// await links.close(); await database.disconnect(); // keep this ownership order
