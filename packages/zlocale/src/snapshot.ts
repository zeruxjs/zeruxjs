import type { Catalog, CatalogLimits } from './types.js';
import { bounded, dataEntries, defineCatalog } from './validation.js';

/** Bounds for explicitly transferred public catalogs; no environment or request globals are read. */
export interface SnapshotOptions {
  /** Bounded explicit catalog count in this owner or transfer batch. */
  maxCatalogs?: number;
  /** Explicit bounded UTF-8 source/retained/wire budget for this owner. */
  maxBytes?: number;
  /** Explicit per-catalog message/string/UTF-8 copy limits. */
  limits?: CatalogLimits;
}
/** Versioned, immutable catalog transfer envelope. It carries data, never executable code. */
export interface CatalogSnapshot {
  /** Supported immutable transfer schema version; never executable code. */
  readonly version: 1;
  /** Explicit validated public catalog snapshots; exclude private tenant data. */
  readonly catalogs: readonly Catalog[];
}

/** Validate/copy a transfer batch and reject duplicate locale/domain identities.
 * @param {unknown} input - Inert JSON-shaped candidate validated before any registry/cache mutation.
 * @param {SnapshotOptions} options - Explicit owner policy; limits and native formatting choices are validated before use.
 * @returns {CatalogSnapshot} Frozen envelope. Uses native Intl/TextEncoder through validation, no I/O.
 */
function snapshot(input: unknown, options: SnapshotOptions): CatalogSnapshot {
  /** Bounded explicit transfer count validated before copying catalogs. */
  const maxCatalogs = bounded(options.maxCatalogs, 64, 1024);
  if (!Array.isArray(input) || input.length > maxCatalogs) {
    throw new RangeError('zlocale: invalid snapshot catalog count');
  }
  // Descriptor checks prevent getters or custom array properties from entering serialization.
  /** Own array descriptors reject getters, symbols, sparse or unexpected fields. */
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (
    Object.getOwnPropertySymbols(input).length ||
    Object.keys(descriptors).some(
      (key) =>
        key !== 'length' &&
        (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= input.length)
    ) ||
    Object.values(descriptors).some(
      (descriptor) => !Object.hasOwn(descriptor, 'value')
    )
  ) {
    throw new TypeError('zlocale: snapshot requires a plain catalog array');
  }
  /** Validated immutable catalog snapshots selected explicitly by the host. */
  const catalogs: Catalog[] = [];
  /** Batch-local locale/domain set preventing ambiguous duplicate transfer records. */
  const identities = new Set<string>();
  for (let index = 0; index < input.length; index++) {
    /** Defensively validated data from one own array slot. */
    const catalog = defineCatalog(
      descriptors[String(index)]?.value,
      options.limits
    );
    /** Canonical exact locale/domain transfer identity. */
    const identity = `${catalog.locale}/${catalog.domain}`;
    if (identities.has(identity)) {
      throw new Error('zlocale: duplicate snapshot catalog');
    }
    identities.add(identity);
    catalogs.push(catalog);
  }
  return Object.freeze({ version: 1, catalogs: Object.freeze(catalogs) });
}

/** Serialize explicitly selected public catalogs for an HTML JSON data block or transport.
 * @param {readonly Catalog[]} catalogs - Explicit public catalogs selected for transfer; no private user data belongs here.
 * @param {SnapshotOptions} options - Explicit owner policy; limits and native formatting choices are validated before use.
 * @returns {string} Validated JSON with HTML delimiters and line separators escaped. Never reads globals, loads catalogs, or executes text.
 */
export function serializeCatalogs(
  catalogs: readonly Catalog[],
  options: SnapshotOptions = {}
): string {
  /** Bounded UTF-8 wire budget checked before parsing or assembling output. */
  const maxBytes = bounded(options.maxBytes, 8 * 1024 * 1024, 64 * 1024 * 1024);
  /** Validated immutable V1 transfer facts, never an executable runtime. */
  const envelope = snapshot(catalogs, options);
  /** Fixed script-data escapes preventing HTML/script termination; not attribute encoding. */
  const replacements: Record<string, string> = {
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
  };
  // Measure each catalog before joining so the final envelope cannot grow without a bound.
  /** Native UTF-8 byte counter owned by this synchronous serialization call. */
  const encoder = new TextEncoder();
  let bytes = encoder.encode('{"version":1,"catalogs":[]}').length;
  /** Bounded escaped catalog JSON fragments joined only after budget checks. */
  const parts: string[] = [];
  for (const catalog of envelope.catalogs) {
    /** One escaped data fragment measured before retention. */
    const part = JSON.stringify(catalog).replace(
      /[<>&\u2028\u2029]/g,
      (character) => replacements[character]!
    );
    bytes += encoder.encode(part).length + (parts.length ? 1 : 0);
    if (bytes > maxBytes) {
      throw new RangeError('zlocale: snapshot byte limit exceeded');
    }
    parts.push(part);
  }
  if (bytes > maxBytes) {
    throw new RangeError('zlocale: snapshot byte limit exceeded');
  }
  return `{"version":1,"catalogs":[${parts.join(',')}]}`;
}

/** Parse a versioned snapshot and defensively validate every catalog.
 * @param {string} text - Bounded plain JSON or source text; never executed as a module or program.
 * @param {SnapshotOptions} options - Explicit owner policy; limits and native formatting choices are validated before use.
 * @returns {CatalogSnapshot} Frozen envelope for explicit registerCatalogs calls. Uses JSON/TextEncoder/Intl; no DOM, files, network, eval, or request globals.
 */
export function parseCatalogs(
  text: string,
  options: SnapshotOptions = {}
): CatalogSnapshot {
  /** Bounded UTF-8 wire budget checked before parsing or assembling output. */
  const maxBytes = bounded(options.maxBytes, 8 * 1024 * 1024, 64 * 1024 * 1024);
  if (
    typeof text !== 'string' ||
    text.length > maxBytes ||
    new TextEncoder().encode(text).length > maxBytes
  ) {
    throw new RangeError('zlocale: snapshot byte limit exceeded');
  }
  /** Own parsed envelope fields; version and catalog presence are validated explicitly. */
  const properties = new Map(dataEntries(JSON.parse(text)));
  if (
    properties.size !== 2 ||
    properties.get('version') !== 1 ||
    !properties.has('catalogs')
  ) {
    throw new TypeError('zlocale: unsupported catalog snapshot');
  }
  return snapshot(properties.get('catalogs'), options);
}
