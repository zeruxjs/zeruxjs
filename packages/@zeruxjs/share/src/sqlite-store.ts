import type { SqliteConnector } from "@zeruxjs/db-sqlite";
import {
  ShortLinkError,
  type ShortLinkStore,
  type ShortLinkRecord,
} from "./server.js";
/** Host-owned SQLite table/connector. No connection is opened or closed by this adapter. */
export function createSqliteShortLinkStore(options: {
  database: SqliteConnector;
  persistent: true;
  table?: string;
  initialize?: boolean;
}): ShortLinkStore {
  if (
    !options ||
    typeof options !== "object" ||
    Object.keys(options).some(
      (k) => !["database", "persistent", "table", "initialize"].includes(k),
    ) ||
    Object.values(Object.getOwnPropertyDescriptors(options)).some(
      (d) => !("value" in d),
    )
  )
    throw new ShortLinkError("INVALID");
  const db = options.database,
    table = options.table ?? "share_short_links";
  if (
    options.persistent !== true ||
    db?.synchronousTransactions !== true ||
    typeof db.transactionSync !== "function" ||
    typeof table !== "string" ||
    !/^[a-z][a-z0-9_]{0,63}$/.test(table) ||
    (options.initialize !== undefined &&
      typeof options.initialize !== "boolean")
  )
    throw new ShortLinkError("INVALID");
  const eq = (field: string, value: string) => ({
    field,
    operator: "eq" as const,
    value,
  });
  function signal(value: AbortSignal) {
    if (!(value instanceof AbortSignal)) throw new ShortLinkError("INVALID");
    value.throwIfAborted();
  }
  function key(value: string) {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
      throw new ShortLinkError("INVALID");
  }
  function encoded(value: Readonly<ShortLinkRecord>) {
    if (
      !value ||
      typeof value !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length > 32 ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(
        (d) =>
          !("value" in d) ||
          (d.value !== null &&
            !["string", "number", "boolean"].includes(typeof d.value)),
      )
    )
      throw new ShortLinkError("INVALID");
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > 16384) throw new ShortLinkError("LIMIT");
    return text;
  }
  try {
    if (options.initialize)
      db.transactionSync((tx) => {
        const result = tx.execute({
          op: "createTable",
          table,
          ifNotExists: true,
          columns: [
            { name: "key", type: "text", primary: true, notNull: true },
            { name: "revision", type: "text", notNull: true },
            { name: "payload", type: "text", notNull: true },
          ],
        });
        if (!result.ok)
          throw new Error("Short-link table initialization failed");
      });
  } catch (cause) {
    throw new ShortLinkError("UNAVAILABLE", "unknown", cause);
  }
  return {
    capability: "short-links-cas-v1",
    durable: true,
    async reserve(id, value, abort) {
      signal(abort);
      key(id);
      const payload = encoded(value);
      return db.transactionSync(
        (tx) => {
          const found = tx.select({ table, where: eq("key", id), limit: 1 });
          if (!found.ok) throw new ShortLinkError("UNAVAILABLE");
          if (found.rows?.length) return false;
          const result = tx.insert({
            table,
            values: { key: id, revision: value.revision, payload },
          });
          if (!result.ok || result.affectedCount !== 1)
            throw new ShortLinkError("UNAVAILABLE");
          return true;
        },
        { signal: abort },
      );
    },
    async read(id, abort) {
      signal(abort);
      key(id);
      return db.transactionSync(
        (tx) => {
          const result = tx.select({
            table,
            where: eq("key", id),
            limit: 2,
          });
          if (!result.ok || (result.rows?.length ?? 0) > 1)
            throw new ShortLinkError("UNAVAILABLE");
          const row = result.rows?.[0];
          if (row === undefined) return null;
          if (!row || typeof row !== "object")
            throw new ShortLinkError("UNAVAILABLE");
          const field = Object.getOwnPropertyDescriptor(row, "payload");
          if (
            !field ||
            !("value" in field) ||
            typeof field.value !== "string" ||
            Buffer.byteLength(field.value) > 16384
          )
            throw new ShortLinkError("UNAVAILABLE");
          return JSON.parse(field.value) as ShortLinkRecord;
        },
        { signal: abort },
      );
    },
    async compareAndSwap(id, revision, value, abort) {
      signal(abort);
      key(id);
      if (typeof revision !== "string" || revision.length > 64)
        throw new ShortLinkError("INVALID");
      const payload = encoded(value);
      return db.transactionSync(
        (tx) => {
          const result = tx.update({
            table,
            where: { and: [eq("key", id), eq("revision", revision)] },
            values: { revision: value.revision, payload },
          });
          if (
            !result.ok ||
            (result.affectedCount !== 0 && result.affectedCount !== 1)
          )
            throw new ShortLinkError("UNAVAILABLE");
          return result.affectedCount === 1;
        },
        { signal: abort },
      );
    },
  };
}
