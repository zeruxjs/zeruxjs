import { escapeHtmlText } from '@zeruxjs/security/encoding';
import { identifier, record, list, pageSlug } from './validation.js';
import {
  pageMetadata,
  versionMetadata,
  type DocumentationPageMetadata,
  type DocumentationVersionMetadata,
} from './metadata.js';
import { validateImage, type DocumentationImage } from './images.js';
import { imagePolicy } from './markdown-images.js';

/** Literal Markdown or an explicit reference to a version-owned reusable part. */
export type DocumentationPart =
  | string
  | {
      /** Registered part identifier, never a file/module path. */ include: string;
    };
export interface DocumentationDocument extends DocumentationPageMetadata {
  /** Stable version-local route; changing a title never changes this identifier. */
  slug: string;
  /** Human-authored title, required unless removing an inherited page. */
  title?: string;
  /** Inert Markdown parts; no expression/module execution occurs. */
  parts?: readonly DocumentationPart[];
  /** Explicit publication policy; omission remains private. */
  access?: 'public' | 'private';
  /** Optional inert sidebar section label, at most 128 characters. */
  section?: string;
  /** Explicit navigation order; ties use stable slug ordering. */
  order?: number;
  /** Remove an inherited page without silently deleting it from other versions. */
  remove?: boolean;
}
export interface DocumentationVersion extends DocumentationVersionMetadata {
  /** Explicit release identifier; versions are never inferred from package versions. */
  id: string;
  /** Optional parent version; cycles and chains deeper than eight reject. */
  extends?: string;
  /** New/replacement pages or explicit inherited-page removals. */
  documents: readonly DocumentationDocument[];
  /** Explicit version-owned image aliases; null removes an inherited image. */
  images?: Readonly<Record<string, DocumentationImage | null>>;
  /** Version-local reusable parts, inherited and overridden by name. */
  fragments?: Readonly<Record<string, readonly DocumentationPart[]>>;
}
export interface DocumentationDefinition {
  /** Explicit default version; must exist. */
  latest: string;
  /** Public mount, default /docs; no origin is inferred from a request. */
  basePath?: string;
  /** At most 32 explicitly registered versions. */
  versions: readonly DocumentationVersion[];
}
export interface DocumentationPage extends Readonly<DocumentationPageMetadata> {
  /** Owning version identifier. */
  readonly version: string;
  /** Stable route identifier. */
  readonly slug: string;
  /** Literal authored title. */
  readonly title: string;
  /** Optional authored sidebar section. */
  readonly section?: string;
  /** Explicit navigation order, default zero. */
  readonly order?: number;
  /** Approximate expanded prose reading time in minutes, not a completion measure. */
  readonly readingMinutes?: number;
  /** Expanded inert Markdown, bounded to 1 MiB of UTF-16 units. */
  readonly body: string;
  /** Canonical mount-relative pathname with trailing slash. */
  readonly url: string;
  /** Host-enforced publication policy. */
  readonly access: 'public' | 'private';
}
export interface DocumentationSnapshot {
  /** Expanded snapshot schema; imported snapshots never carry executable callbacks. */
  schemaVersion: 1;
  /** Explicit default version. */
  latest: string;
  /** Canonical public mount. */
  basePath: string;
  /** Expanded version/page data, independent of future fragment edits. */
  versions: (DocumentationVersionMetadata & {
    id: string;
    documents: DocumentationDocument[];
    images?: Record<string, DocumentationImage>;
  })[];
}

/** Validate and copy one bounded part list without executing source content.
 * @param {unknown} input - Literal strings and explicit include records.
 * @returns {DocumentationPart[]} Detached validated part list.
 */
function parts(input: unknown): DocumentationPart[] {
  return list(input, 256).map((item) => {
    if (typeof item === 'string') {
      if (item.length > 1_048_576) {
        throw new RangeError('Documentation part too large');
      }
      return item;
    }
    /** Include records carry a name only; URLs, scripts and file paths are unsupported. */
    const reference = record(item);
    if (
      Object.keys(reference).length !== 1 ||
      !Object.hasOwn(reference, 'include')
    ) {
      throw new TypeError('Invalid documentation include');
    }
    return { include: identifier(reference.include) };
  });
}

/** Compile explicit versioned documents and reusable parts into immutable pages.
 * @param {DocumentationDefinition} definition - Trusted registration containing inert authored data; runtime validation still applies.
 * @returns {DocumentationCatalog} Detached catalog with bounded lookup, comparison and expanded snapshots.
 */
export function createDocumentation(definition: DocumentationDefinition) {
  /** Validate outer structure before consuming any configuration field. */
  const input = record(definition);
  /** Explicit public mount, independent of request Host headers. */
  const base = input.basePath ?? '/docs';
  if (
    typeof base !== 'string' ||
    base.length > 256 ||
    !/^\/(?:[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*)?$/.test(base)
  ) {
    throw new TypeError('Invalid documentation base path');
  }
  /** Canonical mount with no trailing separator except root. */
  const basePath = base === '/' ? '' : base;
  if (
    !Array.isArray(input.versions) ||
    input.versions.length < 1 ||
    input.versions.length > 32
  ) {
    throw new RangeError('Documentation requires 1..32 versions');
  }
  /** Version definitions never share mutable host objects after registration. */
  const definitions = new Map<string, Record<string, unknown>>();
  for (const item of list(input.versions, 32)) {
    /** Validated version-local input. */
    const version = record(item);
    /** Explicit immutable release identity. */
    const id = identifier(version.id);
    if (definitions.has(id)) {
      throw new TypeError('Duplicate documentation version');
    }
    versionMetadata(version);
    definitions.set(id, version);
  }
  /** Default version must be explicitly registered. */
  const latest = identifier(input.latest);
  if (!definitions.has(latest)) {
    throw new TypeError('Unknown latest documentation version');
  }
  /** Resolved immutable text inputs for inheritance, scoped to this catalog only. */
  const resolved = new Map<
    string,
    {
      documents: Map<string, DocumentationDocument>;
      fragments: Map<string, DocumentationPart[]>;
      images: Map<string, DocumentationImage>;
    }
  >();
  /** Expanded public/private page inventory; publication is a separate host decision. */
  const inventory: DocumentationPage[] = [];
  let total = 0;
  let imageCharacters = 0;
  /** Resolve one bounded inheritance chain before rendering any document.
   * @param {string} id - Registered version identity.
   * @param {string[]} chain - Current bounded recursion path.
   * @returns {object} Detached inherited document/part maps.
   */
  function resolve(
    id: string,
    chain: string[]
  ): {
    documents: Map<string, DocumentationDocument>;
    fragments: Map<string, DocumentationPart[]>;
    images: Map<string, DocumentationImage>;
  } {
    if (chain.includes(id) || chain.length >= 8) {
      throw new TypeError('Documentation inheritance cycle/depth');
    }
    /** Reuse only fully resolved version data. */
    const cached = resolved.get(id);
    if (cached) {
      return cached;
    }
    /** Registered inert version definition. */
    const version = definitions.get(id);
    if (!version) {
      throw new TypeError('Unknown parent documentation version');
    }
    /** Parent maps are copied before descendant overrides. */
    const parent =
      version.extends === undefined
        ? undefined
        : resolve(identifier(version.extends), [...chain, id]);
    /** Descendant ownership prevents edits changing a parent version. */
    const documents = new Map(parent?.documents);
    /** Reusable parts are version-specific, never global mutable substitutions. */
    const fragments = new Map(parent?.fragments);
    /** Images inherit independently from prose; only registered inert URLs are retained. */
    const images = new Map(parent?.images);
    if (version.images !== undefined) {
      for (const [key, image] of Object.entries(record(version.images))) {
        identifier(key);
        if (image === null) {
          images.delete(key);
        } else {
          images.set(key, validateImage(image));
        }
      }
    }
    if (images.size > 1000) {
      throw new RangeError('Documentation image registry limit');
    }
    if (version.fragments !== undefined) {
      for (const [name, body] of Object.entries(record(version.fragments))) {
        fragments.set(identifier(name), parts(body));
      }
    }
    if (
      fragments.size > 2000 ||
      !Array.isArray(version.documents) ||
      version.documents.length > 5000
    ) {
      throw new RangeError('Documentation inventory limit');
    }
    /** Duplicate declarations in one version reject instead of last-write-wins. */
    const seen = new Set<string>();
    for (const candidate of list(version.documents, 5000)) {
      /** Validated document record. */
      const doc = record(candidate);
      /** Stable version-local route. */
      const slug = pageSlug(doc.slug);
      if (seen.has(slug)) {
        throw new TypeError('Duplicate documentation page');
      }
      seen.add(slug);
      if (doc.remove === true) {
        documents.delete(slug);
        continue;
      }
      if (doc.remove !== undefined && doc.remove !== false) {
        throw new TypeError('Invalid documentation removal');
      }
      if (
        typeof doc.title !== 'string' ||
        !doc.title.trim() ||
        doc.title.length > 512
      ) {
        throw new TypeError('Invalid documentation title');
      }
      if (
        doc.access !== undefined &&
        doc.access !== 'public' &&
        doc.access !== 'private'
      ) {
        throw new TypeError('Invalid documentation access');
      }
      if (
        doc.section !== undefined &&
        (typeof doc.section !== 'string' ||
          !doc.section.trim() ||
          doc.section.length > 128)
      ) {
        throw new TypeError('Invalid documentation section');
      }
      if (
        doc.order !== undefined &&
        (typeof doc.order !== 'number' ||
          !Number.isSafeInteger(doc.order) ||
          Math.abs(doc.order) > 1_000_000)
      ) {
        throw new TypeError('Invalid documentation order');
      }
      documents.set(slug, {
        ...pageMetadata(doc),
        ...(doc.section === undefined
          ? {}
          : { section: doc.section as string }),
        ...(doc.order === undefined ? {} : { order: doc.order as number }),
        slug,
        title: doc.title,
        parts: parts(doc.parts),
        access: doc.access === 'public' ? 'public' : 'private',
      });
    }
    if (documents.size > 5000) {
      throw new RangeError('Documentation page limit');
    }
    /** Only complete maps enter the cache. */
    const result = { documents, fragments, images };
    resolved.set(id, result);
    return result;
  }
  // Sort identities explicitly so input registration order cannot change output order.
  for (const id of [...definitions.keys()].sort()) {
    /** Version-owned maps used only while compiling immutable page data. */
    const version = resolve(id, []);
    imageCharacters += JSON.stringify([...version.images]).length;
    if (imageCharacters > 8_388_608) {
      throw new RangeError('Documentation image metadata budget');
    }
    for (const [slug, doc] of [...version.documents].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    )) {
      let expansions = 0;
      /** Expand named inert parts with bounded recursion and cumulative output.
       * @param {readonly DocumentationPart[]} list - Validated inert text/reference list.
       * @param {string[]} chain - Current fragment path for cycle checks.
       * @returns {string} Expanded Markdown; never evaluated as code.
       */
      function expand(
        list: readonly DocumentationPart[],
        chain: string[]
      ): string {
        if (chain.length > 16) {
          throw new RangeError('Documentation include depth');
        }
        return list
          .map((part) => {
            if (++expansions > 4096) {
              throw new RangeError('Documentation expansion limit');
            }
            if (typeof part === 'string') {
              total += part.length;
              if (total > 16_777_216) {
                throw new RangeError('Documentation catalog size');
              }
              return part;
            }
            if (chain.includes(part.include)) {
              throw new TypeError('Documentation include cycle');
            }
            /** Only registered version-owned parts can be included. */
            const included = version.fragments.get(part.include);
            if (!included) {
              throw new TypeError('Unknown documentation part');
            }
            return expand(included, [...chain, part.include]);
          })
          .join('\n\n');
      }
      /** Expanded Markdown is detached from caller objects. */
      const body = expand(doc.parts!, []);
      if (body.length > 1_048_576 || inventory.length >= 10_000) {
        throw new RangeError('Documentation output limit');
      }
      inventory.push(
        Object.freeze({
          version: id,
          slug,
          title: doc.title!,
          ...pageMetadata(doc as unknown as Record<string, unknown>),
          readingMinutes: Math.max(
            1,
            Math.ceil(body.split(/\s+/u).filter(Boolean).length / 200)
          ),
          ...(doc.section === undefined ? {} : { section: doc.section }),
          ...(doc.order === undefined ? {} : { order: doc.order }),
          body,
          access: doc.access!,
          url: `${basePath}/${id}/${slug}/`,
        })
      );
    }
  }
  /** Immutable identity metadata; methods return detached inventories. */
  const versionIds = Object.freeze([...definitions.keys()].sort());
  /** Identity index owns immutable references; callers cannot mutate its keys. */
  const identities = new Map(
    inventory.map((page) => [page.version + '/' + page.slug, page])
  );
  /** Version-local inventories avoid copying unrelated releases for navigation. */
  const byVersion = new Map(
    versionIds.map((id) => [
      id,
      inventory.filter((page) => page.version === id),
    ])
  );
  /** Catalog-owned immutable aliases are sorted once for deterministic snapshots and cheap rendering. */
  const imageInventories = new Map(
    versionIds.map((id) => [
      id,
      Object.freeze(
        Object.fromEntries(
          [...resolved.get(id)!.images].sort(
            ([a], [b]) => Number(a > b) - Number(a < b)
          )
        )
      ),
    ])
  );
  /** Missing releases expose no mutable resource state. */
  const emptyImages: Readonly<Record<string, DocumentationImage>> =
    Object.freeze({});
  /** Version metadata is source-owned and detached, never inferred from a build clock. */
  const releases = new Map(
    versionIds.map((id) => [
      id,
      Object.freeze({ id, ...versionMetadata(definitions.get(id)!) }),
    ])
  );
  return Object.freeze({
    latest,
    basePath: basePath || '/',
    versions: versionIds,
    /** Read immutable release presentation metadata.
     * @param {string} id - Exact registered version.
     * @returns {Readonly<DocumentationVersionMetadata & {id:string}>|undefined} Authored release metadata or undefined.
     */
    version(id: string) {
      return releases.get(id);
    },
    /** Read registered immutable images; private metadata remains host-authorized.
     * @param {string} id - Exact owning version.
     * @returns {Readonly<Record<string,DocumentationImage>>} Immutable sorted alias map of immutable image records.
     */
    images(id: string): Readonly<Record<string, DocumentationImage>> {
      return imageInventories.get(id) ?? emptyImages;
    },
    /** Find one page without changing version or silently falling back to unrelated content.
     * @param {string} version - Exact registered release.
     * @param {string} slug - Exact stable page identifier.
     * @returns {DocumentationPage | undefined} Immutable page or missing evidence.
     */
    get(version: string, slug: string) {
      if (typeof version !== 'string' || typeof slug !== 'string') {
        return undefined;
      }
      return identities.get(version + '/' + slug);
    },
    /** List immutable pages; host authorization still applies before disclosure.
     * @param {string} [version] - Optional exact release; unknown identities return an empty list.
     * @returns {DocumentationPage[]} Detached array of immutable records.
     */
    pages(version?: string) {
      return [
        ...(version === undefined ? inventory : (byVersion.get(version) ?? [])),
      ];
    },
    /** Export expanded immutable release data without callbacks or live fragment references.
     * @returns {DocumentationSnapshot} Detached version-1 snapshot suitable for host-owned persistence.
     */
    snapshot(): DocumentationSnapshot {
      return {
        schemaVersion: 1,
        latest,
        basePath: basePath || '/',
        versions: versionIds.map((id) => ({
          id,
          ...versionMetadata(definitions.get(id)!),
          ...(resolved.get(id)!.images.size
            ? {
                images: JSON.parse(JSON.stringify(imageInventories.get(id))),
              }
            : {}),
          documents: inventory
            .filter((p) => p.version === id)
            .map((p) => ({
              slug: p.slug,
              title: p.title,
              ...pageMetadata(p as unknown as Record<string, unknown>),
              ...(p.section === undefined ? {} : { section: p.section }),
              ...(p.order === undefined ? {} : { order: p.order }),
              access: p.access,
              parts: [p.body],
            })),
        })),
      };
    },
  });
}
/** Immutable catalog type; no filesystem, watcher or global registry is owned. */
export type DocumentationCatalog = ReturnType<typeof createDocumentation>;

/** Validate and restore an expanded snapshot without evaluating source modules.
 * @param {unknown} input - Version-1 inert snapshot candidate.
 * @returns {DocumentationCatalog} Independently compiled catalog.
 */
export function restoreDocumentation(input: unknown): DocumentationCatalog {
  /** Snapshot header is validated before passing inert version data to the compiler. */
  const snapshot = record(input);
  if (snapshot.schemaVersion !== 1) {
    throw new TypeError('Unsupported documentation snapshot');
  }
  return createDocumentation(snapshot as unknown as DocumentationDefinition);
}
/** Compare expanded releases without mutating history or claiming distributed revision locking.
 * @param {DocumentationCatalog} catalog - Existing immutable catalog.
 * @param {string} before - Exact original release.
 * @param {string} after - Exact replacement release.
 * @returns {{added:string[],removed:string[],changed:string[]}} Deterministically ordered route changes.
 */
export function compareDocumentation(
  catalog: DocumentationCatalog,
  before: string,
  after: string
) {
  if (!catalog.versions.includes(before) || !catalog.versions.includes(after)) {
    throw new TypeError('Unknown documentation comparison version');
  }
  /** Original version keyed by stable route identity. */
  const left = new Map(
    catalog
      .pages()
      .filter((p) => p.version === before)
      .map((p) => [p.slug, p])
  );
  /** Replacement version keyed by stable route identity. */
  const right = new Map(
    catalog
      .pages()
      .filter((p) => p.version === after)
      .map((p) => [p.slug, p])
  );
  return {
    added: [...right.keys()].filter((id) => !left.has(id)),
    removed: [...left.keys()].filter((id) => !right.has(id)),
    changed: [...right.keys()].filter((id) => {
      const a = left.get(id);
      const b = right.get(id)!;
      return (
        a !== undefined &&
        (a.title !== b.title ||
          a.body !== b.body ||
          a.access !== b.access ||
          a.section !== b.section ||
          a.order !== b.order ||
          JSON.stringify(
            pageMetadata(a as unknown as Record<string, unknown>)
          ) !==
            JSON.stringify(
              pageMetadata(b as unknown as Record<string, unknown>)
            ))
      );
    }),
  };
}
/** Render an inert default document; hosts can supply a separately trusted Markdown/component renderer.
 * @param {DocumentationPage} page - Compiled immutable page.
 * @returns {string} Complete escaped HTML with no inline script, style or raw authored HTML.
 */
export function renderDocumentationPage(page: DocumentationPage): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtmlText(page.title)}</title></head><body><main class="zerux-docs"><h1>${escapeHtmlText(page.title)}</h1><pre>${escapeHtmlText(page.body)}</pre></main></body></html>`;
}
/** Create a request-scoped Fetch consumer; private content requires a fresh host decision.
 * @param {DocumentationCatalog} catalog - Borrowed immutable catalog.
 * @param {object} options - Explicit host authorization and trusted presentation callbacks.
 * @param {(request:Request,page:DocumentationPage)=>boolean|Promise<boolean>} [options.authorize] - Required for private pages; omission denies.
 * @param {(page:DocumentationPage)=>string|Promise<string>} [options.render] - Trusted renderer, never imported from saved definitions.
 * @param {readonly string[]} [options.imageOrigins] - Explicit remote origins allowed by the response CSP; does not authorize image metadata.
 * @param {boolean} [options.enableLocalScripts] - Explicit same-origin script approval for host-authored browser enhancements, disabled by default.
 * @returns {(request:Request)=>Promise<Response>} Fetch handler; no server starts on import.
 */
export function createDocumentationHandler(
  catalog: DocumentationCatalog,
  options: {
    authorize?: (
      request: Request,
      page: DocumentationPage
    ) => boolean | Promise<boolean>;
    render?: (page: DocumentationPage) => string | Promise<string>;
    /** Explicit HTTPS image origins additionally approved for the handler CSP. */
    imageOrigins?: readonly string[];
    /** Explicit host approval for same-origin module scripts; defaults disabled. */
    enableLocalScripts?: boolean;
  } = {}
) {
  if (
    options.enableLocalScripts !== undefined &&
    typeof options.enableLocalScripts !== 'boolean'
  ) {
    throw new TypeError('Invalid documentation script policy');
  }
  /** CSP approval is a separate host decision from the renderer image registry. */
  const imageOrigins = [
    ...imagePolicy({ allowedImageOrigins: options.imageOrigins }).origins,
  ];
  /** Build exact route lookup once; authorization still runs separately for every request. */
  const routes = new Map(catalog.pages().map((page) => [page.url, page]));
  return async (request: Request): Promise<Response> => {
    request.signal.throwIfAborted();
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response(null, {
        status: 405,
        headers: { Allow: 'GET, HEAD', 'Cache-Control': 'private, no-store' },
      });
    }
    /** Exact stored path lookup never selects a filesystem path or outbound URL. */
    const page = routes.get(new URL(request.url).pathname);
    if (
      !page ||
      (page.access === 'private' &&
        (await options.authorize?.(request, page)) !== true)
    ) {
      return new Response('Not found', {
        status: 404,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    /** Trusted rendering remains separate from stored inert text. */
    const html = await (options.render ?? renderDocumentationPage)(page);
    request.signal.throwIfAborted();
    return new Response(request.method === 'HEAD' ? null : html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy':
          "default-src 'none'; style-src 'self'; img-src 'self'" +
          (imageOrigins.length ? ' ' + imageOrigins.join(' ') : '') +
          (options.enableLocalScripts ? "; script-src 'self'" : '') +
          "; base-uri 'none'; frame-ancestors 'none'",
        ...(page.access === 'private'
          ? { 'X-Robots-Tag': 'noindex, nofollow' }
          : {}),
      },
    });
  };
}

export { documentationNavigation } from './navigation.js';

export type { DocumentationImage, DocumentationImageSource } from './images.js';
export type {
  DocumentationPageMetadata,
  DocumentationVersionMetadata,
} from './metadata.js';

/** Compare authored page/image/release changes without emitting document bodies or binary contents.
 * @param {DocumentationCatalog} catalog - Host-authorized complete catalog.
 * @param {string} before - Exact original release.
 * @param {string} after - Exact target release.
 * @returns {object} Page changes, image alias changes and a release-metadata change indicator.
 */
export function compareDocumentationVersions(
  catalog: DocumentationCatalog,
  before: string,
  after: string
) {
  /** Existing page comparison retains its compatible result shape. */
  const pages = compareDocumentation(catalog, before, after);
  /** Maps contain immutable metadata; only alias identities enter the result. */
  const left = catalog.images(before);
  /** Descendant overrides do not mutate the original image registry. */
  const right = catalog.images(after);
  return {
    pages,
    images: {
      added: Object.keys(right)
        .filter((id) => !Object.hasOwn(left, id))
        .sort(),
      removed: Object.keys(left)
        .filter((id) => !Object.hasOwn(right, id))
        .sort(),
      changed: Object.keys(right)
        .filter(
          (id) =>
            Object.hasOwn(left, id) &&
            JSON.stringify(left[id]) !== JSON.stringify(right[id])
        )
        .sort(),
    },
    metadataChanged:
      JSON.stringify(versionMetadata(catalog.version(before)!)) !==
      JSON.stringify(versionMetadata(catalog.version(after)!)),
  };
}
