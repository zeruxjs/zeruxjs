import type { SqliteConnector } from "@zeruxjs/db-sqlite";
import { createSqliteShortLinkStore } from "@zeruxjs/share/sqlite";
import type { ShortLinkOptions } from "@zeruxjs/share/server";
import { configureLinks } from "./short-links.js";

// Host must supply a writable connector on a qualified persistent file, not :memory:.
export function configureSqliteLinks(
  database: SqliteConnector,
  authorize: ShortLinkOptions["authorize"],
  initialize = false,
) {
  const store = createSqliteShortLinkStore({
    database,
    persistent: true,
    initialize,
  });
  return configureLinks(store, authorize);
}
// Initialize only when deliberately provisioning the host-owned share_short_links table.
// await links.close(); await database.disconnect(); // keep this ownership order
