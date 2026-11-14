import {
  compileRoutePattern,
  compareRoutePatterns,
  sanitizePathname,
} from './route-pattern.js';
export interface PublicRouteAsset {
  /** Validated local public JavaScript asset URL. */
  readonly url: string;
  /** SHA-256 subresource integrity for the registered public asset. */
  readonly integrity: string;
}
export interface NavigationRouteMetadata {
  /** Stable authored public route identifier. */
  id: string;
  /** Ordered authored structural layout identifiers. */
  layouts?: readonly string[];
  /** Explicit named public build entry; absence means no module execution. */
  clientEntry?: string;
}
export interface PublicNavigationRoute {
  /** Stable authored public route identifier. */
  readonly id: string;
  /** Canonical public route pattern using the shared matcher grammar. */
  readonly pattern: string;
  /** Validated parameter names reconstructed from the route pattern. */
  readonly parameters: readonly {
    /** Bounded authored parameter name. */
    readonly name: string;
    /** Whether this parameter is the final catch-all segment. */
    readonly catchAll: boolean;
  }[];
  /** Ordered authored structural layout identifiers. */
  readonly layouts: readonly string[];
  /** Optional validated manifest-selected module asset. */
  readonly asset?: PublicRouteAsset;
}
export interface PublicRouteManifest {
  /** Explicit public manifest schema version 1. */
  readonly version: 1;
  /** Canonical public mount prefix, independent of private filesystem paths. */
  readonly basePath: string;
  /** Opted-in public route descriptors only. */
  readonly routes: readonly PublicNavigationRoute[];
  /** Explicit not-found/error route-ID references. */
  readonly boundaries: Readonly<{
    /** Existing public route ID for the not-found boundary. */
    notFound?: string; /** Existing public route ID for the error boundary. */
    error?: string;
  }>;
}
export interface PublicRouteManifestOptions {
  /** Canonical public mount prefix, independent of private filesystem paths. */
  basePath?: string;
  /** Borrowed named public build asset resolver. */
  assets?: {
    /** Resolve an explicitly declared client entry from the public build manifest.
     * @param {string} name - Authored named build entry.
     * @returns {PublicRouteAsset} Validated local URL/integrity metadata.
     */
    entry(name: string): PublicRouteAsset;
  };
  /** Explicit not-found/error route-ID references. */
  boundaries?: {
    /** Existing public route ID for the not-found boundary. */
    notFound?: string; /** Existing public route ID for the error boundary. */
    error?: string;
  };
}
/** Validate authored public IDs without accepting prototype-sensitive names.
 * @param {unknown} value - Candidate route/layout identifier.
 * @returns {boolean} Whether the candidate matches the bounded identifier policy.
 */
const identifier = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value) &&
  !['constructor', 'prototype'].includes(value);
/** Fixed public diagnostic vocabulary; arbitrary internal messages never become codes. */
export const NAVIGATION_ERROR_CODES = Object.freeze([
  'NAVIGATION_ASSET_INVALID',
  'NAVIGATION_ASSET_REQUIRED',
  'NAVIGATION_BASE_MISMATCH',
  'NAVIGATION_BODY_LIMIT',
  'NAVIGATION_BOUNDARY_INVALID',
  'NAVIGATION_CLEANUP_INVALID',
  'NAVIGATION_CLOSED',
  'NAVIGATION_DOCUMENT_FAILED',
  'NAVIGATION_DOCUMENT_LIMIT',
  'NAVIGATION_DOCUMENT_IDENTITY_REQUIRED',
  'NAVIGATION_DOCUMENT_UNSAFE',
  'NAVIGATION_FAILED',
  'NAVIGATION_HISTORY_UNAVAILABLE',
  'NAVIGATION_INITIAL_ROUTE_INVALID',
  'NAVIGATION_LAYOUT_INVALID',
  'NAVIGATION_LIMIT_INVALID',
  'NAVIGATION_LOADER_INVALID',
  'NAVIGATION_LOADER_LIMIT',
  'NAVIGATION_MANIFEST_INVALID',
  'NAVIGATION_MODULE_INVALID',
  'NAVIGATION_MODULE_LOADER_REQUIRED',
  'NAVIGATION_OPTIONS_INVALID',
  'NAVIGATION_OVERLOAD',
  'NAVIGATION_PAGE_CLOSED',
  'NAVIGATION_PREFETCH_FAILED',
  'NAVIGATION_RENDERER_INVALID',
  'NAVIGATION_ROOT_INVALID',
  'NAVIGATION_ROUTE_INVALID',
  'NAVIGATION_SCOPE_INVALID',
  'NAVIGATION_TIMEOUT',
  'NAVIGATION_URL_DENIED',
  'NAVIGATION_URL_INVALID',
] as const);
export type NavigationErrorCode = (typeof NAVIGATION_ERROR_CODES)[number];
/** Public navigation failure with a fixed safe classification and no private cause text. */
export class NavigationError extends Error {
  readonly code: NavigationErrorCode;
  /** Expose only a fixed navigation error code without carrying arbitrary private messages.
   * @param {string} code - Candidate classification, restricted to the known public vocabulary.
   */
  constructor(code: string) {
    /** Known public code or fixed fallback, excluding private cause text. */
    const safe =
      NAVIGATION_ERROR_CODES.find((value) => value === code) ??
      'NAVIGATION_FAILED';
    super(safe);
    this.code = safe;
    this.name = 'NavigationError';
  }
}
/** Validate and freeze a local JavaScript asset reference without fetching or executing it.
 * @param {PublicRouteAsset} value - Candidate public URL/integrity metadata.
 * @returns {PublicRouteAsset} Immutable validated descriptor.
 */
export function routeAsset(value: PublicRouteAsset): PublicRouteAsset {
  /** Untrusted candidate local client module URL, validated before public projection. */
  const url = value?.url;
  /** Untrusted candidate SHA-256 integrity value. */
  const integrity = value?.integrity;
  if (
    typeof url !== 'string' ||
    url.length > 2048 ||
    !/^\/(?!\/)[A-Za-z0-9_./-]+\.m?js$/.test(url) ||
    url.split('/').some((part) => part === '.' || part === '..') ||
    typeof integrity !== 'string' ||
    !/^sha256-[A-Za-z0-9+/]{43}=$/.test(integrity)
  ) {
    throw new NavigationError('NAVIGATION_ASSET_INVALID');
  }
  return Object.freeze({ url, integrity });
}
/** Check exact base-path containment with a slash boundary.
 * @param {string} pathname - Candidate pathname.
 * @param {string} base - Validated public mount prefix.
 * @returns {boolean} Whether the path lies at or below the configured mount.
 */
export function withinBase(pathname: string, base: string): boolean {
  return base === '/' || pathname === base || pathname.startsWith(base + '/');
}
/** Validate an untrusted serialized manifest and reconstruct immutable public route facts.
 * @param {unknown} value - Untrusted manifest input.
 * @returns {PublicRouteManifest} Bounded V1 manifest with validated layouts/assets/boundaries.
 */
export function readPublicRouteManifest(value: unknown): PublicRouteManifest {
  /** Untrusted serialized manifest candidate, validated before immutable reconstruction. */
  const input = value as PublicRouteManifest;
  if (
    !input ||
    input.version !== 1 ||
    typeof input.basePath !== 'string' ||
    !/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(input.basePath) ||
    !Array.isArray(input.routes) ||
    input.routes.length > 1024 ||
    !input.boundaries ||
    typeof input.boundaries !== 'object'
  ) {
    throw new NavigationError('NAVIGATION_MANIFEST_INVALID');
  }
  /** Seen route IDs used to reject duplicates and resolve explicit boundaries. */
  const ids = new Set<string>();
  /** Seen patterns used to reject ambiguous duplicate manifest registration. */
  const patterns = new Set<string>();
  /** Fully validated immutable public route descriptors; handlers never enter this projection. */
  const routes = input.routes.map((route: PublicNavigationRoute) => {
    if (
      !route ||
      !identifier(route.id) ||
      ids.has(route.id) ||
      typeof route.pattern !== 'string' ||
      route.pattern.length > 2048 ||
      sanitizePathname(route.pattern) !== route.pattern ||
      !withinBase(route.pattern, input.basePath) ||
      (route.pattern !== '/' &&
        (!route.pattern.startsWith('/') ||
          !route.pattern
            .slice(1)
            .split('/')
            .every((part) => /^[A-Za-z0-9_.{}:-]+\*?$/.test(part)))) ||
      patterns.has(route.pattern) ||
      !Array.isArray(route.layouts) ||
      route.layouts.length > 8 ||
      !route.layouts.every(identifier) ||
      new Set(route.layouts).size !== route.layouts.length
    ) {
      throw new NavigationError('NAVIGATION_ROUTE_INVALID');
    }
    /** Canonical route pattern segments used to validate dynamic/catch-all grammar. */
    const parts = route.pattern.split('/').filter(Boolean);
    /** Reconstructed parameters derived from the route pattern, ignoring caller-supplied parameter claims. */
    const names = parts
      .filter((part) => part.startsWith(':'))
      .map((part) => ({
        name: part.replace(/^:|\*$/g, ''),
        catchAll: part.endsWith('*'),
      }));
    if (
      names.some((item) => !identifier(item.name)) ||
      new Set(names.map((item) => item.name)).size !== names.length ||
      parts.some(
        (part, index) =>
          part.includes('*') &&
          (!part.startsWith(':') || index !== parts.length - 1)
      )
    ) {
      throw new NavigationError('NAVIGATION_ROUTE_INVALID');
    }
    compileRoutePattern(route.pattern);
    ids.add(route.id);
    patterns.add(route.pattern);
    return Object.freeze({
      id: route.id,
      pattern: route.pattern,
      parameters: Object.freeze(names.map((item) => Object.freeze(item))),
      layouts: Object.freeze([...route.layouts]),
      ...(route.asset ? { asset: routeAsset(route.asset) } : {}),
    });
  });
  /** Fresh validated route-ID boundary projection. */
  const boundaries: {
    /** Existing public route ID for the not-found boundary. */
    notFound?: string; /** Existing public route ID for the error boundary. */
    error?: string;
  } = {};
  for (const key of ['notFound', 'error'] as const) {
    /** Explicit boundary reference required to name an existing public route. */
    const id = input.boundaries[key];
    if (id !== undefined) {
      if (!identifier(id) || !ids.has(id)) {
        throw new NavigationError('NAVIGATION_BOUNDARY_INVALID');
      }
      boundaries[key] = id;
    }
  }
  return Object.freeze({
    version: 1,
    basePath: input.basePath,
    routes: Object.freeze(routes),
    boundaries: Object.freeze(boundaries),
  });
}
/** Project explicitly registered public routes into deterministic shared browser/server grammar without executing source files.
 * @param {PublicRouteManifestOptions & { routes: readonly (NavigationRouteMetadata & { pattern: string })[]; }} options - Explicit public base, assets, boundaries and opted-in route descriptors.
 * @returns {PublicRouteManifest} Immutable validated V1 public manifest.
 */
export function createPublicRouteManifest(
  options: PublicRouteManifestOptions & {
    /** Opted-in public route descriptors only. */
    routes: readonly (NavigationRouteMetadata & {
      /** Canonical public route pattern using the shared matcher grammar. */
      pattern: string;
    })[];
  }
): PublicRouteManifest {
  if (
    !options ||
    !Array.isArray(options.routes) ||
    options.routes.length > 1024
  ) {
    throw new NavigationError('NAVIGATION_MANIFEST_INVALID');
  }
  return readPublicRouteManifest({
    version: 1,
    basePath: options.basePath ?? '/',
    boundaries: options.boundaries ?? {},
    routes: [...options.routes].sort(compareRoutePatterns).map((route) => ({
      id: route.id,
      pattern: route.pattern,
      layouts: route.layouts ?? [],
      ...(route.clientEntry !== undefined
        ? {
            asset:
              options.assets?.entry(route.clientEntry) ??
              (() => {
                throw new NavigationError('NAVIGATION_ASSET_REQUIRED');
              })(),
          }
        : {}),
    })),
  });
}
/** Match only routes within the configured mount using the shared anchored pattern grammar.
 * @param {PublicRouteManifest} manifest - Previously validated public manifest.
 * @param {string} pathname - Candidate navigation path, normalized by the shared matcher.
 * @returns {{route: PublicNavigationRoute; params: Readonly<Record<string, string>>} | null} Matched descriptor and immutable captures, otherwise null.
 */
export function matchNavigationRoute(
  manifest: PublicRouteManifest,
  pathname: string
): {
  route: PublicNavigationRoute;
  params: Readonly<Record<string, string>>;
} | null {
  if (!withinBase(pathname, manifest.basePath)) {
    return null;
  }
  for (const route of manifest.routes) {
    /** Anchored shared route-pattern match; client query values do not alter manifest constraints. */
    const match = compileRoutePattern(route.pattern).regex.exec(
      sanitizePathname(pathname)
    );
    if (match) {
      return { route, params: Object.freeze({ ...match.groups }) };
    }
  }
  return null;
}
