import type { Catalog, CatalogLimits } from "./types.js";
import { bounded, dataEntries, defineCatalog } from "./validation.js";

/** Bounds for explicitly transferred public catalogs; no environment or request globals are read. */
export interface SnapshotOptions {
  maxCatalogs?: number;
  maxBytes?: number;
  limits?: CatalogLimits;
}
/** Versioned, immutable catalog transfer envelope. It carries data, never executable code. */
export interface CatalogSnapshot {
  readonly version: 1;
  readonly catalogs: readonly Catalog[];
}

/** Validate/copy a transfer batch and reject duplicate locale/domain identities. @param input Catalog data. @param options Resource bounds. @returns Frozen envelope. Uses native Intl/TextEncoder through validation, no I/O. */
function snapshot(input: unknown, options: SnapshotOptions): CatalogSnapshot {
  const maxCatalogs = bounded(options.maxCatalogs, 64, 1024);
  if (!Array.isArray(input) || input.length > maxCatalogs)
    throw new RangeError("zlocale: invalid snapshot catalog count");
  // Descriptor checks prevent getters or custom array properties from entering serialization.
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (
    Object.getOwnPropertySymbols(input).length ||
    Object.keys(descriptors).some(
      (key) =>
        key !== "length" &&
        (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= input.length),
    ) ||
    Object.values(descriptors).some(
      (descriptor) => !Object.hasOwn(descriptor, "value"),
    )
  )
    throw new TypeError("zlocale: snapshot requires a plain catalog array");
  const catalogs: Catalog[] = [];
  const identities = new Set<string>();
  for (let index = 0; index < input.length; index++) {
    const catalog = defineCatalog(
      descriptors[String(index)]?.value,
      options.limits,
    );
    const identity = `${catalog.locale}/${catalog.domain}`;
    if (identities.has(identity))
      throw new Error("zlocale: duplicate snapshot catalog");
    identities.add(identity);
    catalogs.push(catalog);
  }
  return Object.freeze({ version: 1, catalogs: Object.freeze(catalogs) });
}

/** Serialize explicitly selected public catalogs for an HTML JSON data block or transport. @param catalogs Catalogs to expose to the client. @param options Bounds (8 MiB output by default). @returns Validated JSON with HTML delimiters and line separators escaped. Never reads globals, loads catalogs, or executes text. */
export function serializeCatalogs(
  catalogs: readonly Catalog[],
  options: SnapshotOptions = {},
): string {
  const maxBytes = bounded(options.maxBytes, 8 * 1024 * 1024, 64 * 1024 * 1024);
  const envelope = snapshot(catalogs, options);
  const replacements: Record<string, string> = {
    "<": "\\u003c",
    ">": "\\u003e",
    "&": "\\u0026",
    "\u2028": "\\u2028",
    "\u2029": "\\u2029",
  };
  // Measure each catalog before joining so the final envelope cannot grow without a bound.
  const encoder = new TextEncoder();
  let bytes = encoder.encode('{"version":1,"catalogs":[]}').length;
  const parts: string[] = [];
  for (const catalog of envelope.catalogs) {
    const part = JSON.stringify(catalog).replace(
      /[<>&\u2028\u2029]/g,
      (character) => replacements[character]!,
    );
    bytes += encoder.encode(part).length + (parts.length ? 1 : 0);
    if (bytes > maxBytes)
      throw new RangeError("zlocale: snapshot byte limit exceeded");
    parts.push(part);
  }
  if (bytes > maxBytes)
    throw new RangeError("zlocale: snapshot byte limit exceeded");
  return `{"version":1,"catalogs":[${parts.join(",")}]}`;
}

/** Parse a versioned snapshot and defensively validate every catalog. @param text JSON text from a trusted transport or DOM data block. @param options Bounds enforced before parsing and before returning catalogs. @returns Frozen envelope for explicit registerCatalogs calls. Uses JSON/TextEncoder/Intl; no DOM, files, network, eval, or request globals. */
export function parseCatalogs(
  text: string,
  options: SnapshotOptions = {},
): CatalogSnapshot {
  const maxBytes = bounded(options.maxBytes, 8 * 1024 * 1024, 64 * 1024 * 1024);
  if (
    typeof text !== "string" ||
    text.length > maxBytes ||
    new TextEncoder().encode(text).length > maxBytes
  )
    throw new RangeError("zlocale: snapshot byte limit exceeded");
  const properties = new Map(dataEntries(JSON.parse(text)));
  if (
    properties.size !== 2 ||
    properties.get("version") !== 1 ||
    !properties.has("catalogs")
  )
    throw new TypeError("zlocale: unsupported catalog snapshot");
  return snapshot(properties.get("catalogs"), options);
}
