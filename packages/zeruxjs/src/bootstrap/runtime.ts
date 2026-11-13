import {
  sanitizePathname,
  compileRoutePattern,
  compareRoutePatterns,
} from '../route-pattern.js';
import { createPublicRouteManifest } from '../navigation-manifest.js';
import {
  loadBuildParser,
  isClientModuleSource,
} from '../compiler/module-boundaries.js';
import { createRendererRegistry, isRenderedHtml } from '../renderers.js';
import { randomBytes } from 'node:crypto';
import type { ServerLifecycleEvents } from '@zeruxjs/hooks';
import { validateCoreConfig } from './config-validation.js';
import {
  createServerLifecycleBridge,
  getServerRequestLifecycle,
} from './server-lifecycle.js';
import { createRequestObserver } from '../observability.js';
import {
  acceptsApiError,
  normalizeApiError,
  ApplicationError,
} from '../exceptions/api-error.js';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { exceptionHandler } from '../exceptions/exception_handler.js';
import {
  findScriptEntry,
  importModule,
  toPosixPath,
  walkDirectory,
} from '../utils/fs.js';
import type { ZeruxConfig } from '../index.js';
import { isRedirectResponse } from '../navigation.js';
import { getResolvedTheme, getThemeConfig, getThemeMode } from '../theme.js';
import {
  initializeRuntimeServices,
  type RuntimeServiceScope,
} from './services.js';
import {
  registerServiceHttpRoutes,
  serviceRouteOverlaps,
} from './service-http.js';
import { createZeruxProtocols, type ZeruxProtocols } from '../protocols.js';
import { ApplicationHttpMetrics } from '../metrics.js';
import { createVariableRegistry } from '../variables.js';
import type { ServiceInitializers } from './services.js';
import {
  applyCachePolicy,
  isCached,
  isStream,
  conditionalEtag,
  sendStream,
  stream,
} from '../response.js';
import type {
  BootstrapResult,
  DiscoveredRoute,
  LoadedModule,
  MiddlewareFunction,
  ResolvedStructure,
  RouteHandler,
  RuntimeMode,
  ZeruxPluginApi,
  ZeruxRequestContext,
  ZeruxRuntime,
} from './types.js';
import { logger } from './logger.js';
import { isAllowedHost } from '../utils/host.js';
import {
  normalizeThreadWorker,
  normalizeWorker,
  ThreadWorkerPool,
} from './worker.js';

type HttpMethod =
  | 'ALL'
  | 'DELETE'
  | 'GET'
  | 'HEAD'
  | 'OPTIONS'
  | 'PATCH'
  | 'POST'
  | 'PUT';

interface MultisiteRegistration {
  /** Explicit authored multisite registration URL, not a forwarded request authority. */
  url: string;
  /** Validated single application folder segment. */
  folderName: string;
  /** Normalized configured multisite host pattern. */
  host: string;
  /** Normalized registered/matched path. */
  pathname: string;
  /** Registered path specificity segment count. */
  pathSize: number;
  /** Stable authored registration order used for ties. */
  order: number;
}

/** Explicit route method vocabulary; arbitrary method strings never select a handler. */
const HTTP_METHODS: HttpMethod[] = [
  'ALL',
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
];

/** Authored structural route filenames excluded from the URL leaf segment. */
const RESERVED_ROUTE_FILE_NAMES = new Set([
  'layout',
  'loading',
  'template',
  'error',
]);

/** Package-owned static extension/MIME catalog loaded as inert JSON, never evaluated code. */
const MIME_TYPES: Record<string, string> = JSON.parse(
  fs.readFileSync(
    new URL('../../assets/json/mime.json', import.meta.url),
    'utf-8'
  )
);

/** Recognize the legacy authored HTML response heuristic; this is not a sanitizer.
 * @param {string} value - Handler string result.
 * @returns {boolean} Whether the existing prefix heuristic requests HTML treatment.
 */
const looksLikeHtml = (value: string) => {
  /** Leading-whitespace-normalized string used only for the HTML prefix heuristic. */
  const trimmed = value.trimStart().toLowerCase();
  return (
    trimmed.startsWith('<!doctype html') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<body') ||
    trimmed.startsWith('<main') ||
    trimmed.startsWith('<section') ||
    trimmed.startsWith('<div')
  );
};

/** Uppercase a registered/native method, retaining GET as the compatibility default.
 * @param {string | undefined} value - Optional native/authored method.
 * @returns {string} Normalized method name; registration separately validates support.
 */
const normalizeMethod = (value?: string) =>
  value ? value.toUpperCase() : 'GET';

/** Normalize optional scalar/list registration metadata without mutating its elements.
 * @param {T | T[] | undefined} value - Optional scalar or array.
 * @returns {T[]} Existing array or scalar/empty wrapper.
 */
const asArray = <T>(value: T | T[] | undefined): T[] => {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

/** Derive a stable extension-free project-relative discovery key.
 * @param {string} rootDir - Trusted project root.
 * @param {string} absolutePath - Discovered authored module path.
 * @returns {string} Slash-normalized module registry key.
 */
const toKey = (rootDir: string, absolutePath: string) => {
  /** Project- or discovery-root-relative source/public path for this stage. */
  const relativePath = toPosixPath(path.relative(rootDir, absolutePath));
  return relativePath.replace(/\.[^.]+$/, '');
};

/** Select only explicit compatible export names from a trusted loaded module.
 * @param {object} loaded - Trusted imported module namespace.
 * @param {string[]} fallbacks - Authored ordered export names.
 * @returns {T | null} First present compatible export value, otherwise null.
 */
const extractModuleValue = <T>(loaded: any, fallbacks: string[]): T | null => {
  for (const fallback of fallbacks) {
    if (loaded[fallback] !== undefined) {
      return loaded[fallback] as T;
    }
  }

  return null;
};

/** Apply the legacy lowercase host/port split used by explicit multisite matching.
 * @param {string} host - Host string already subject to the request admission policy.
 * @returns {string} Compatibility normalized hostname; this is not an independent origin verifier.
 */
const normalizeHost = (host: string) => host.split(':')[0]!.toLowerCase();

/** Rank explicit exact/wildcard multisite registrations deterministically.
 * @param {string} host - Authored registration host pattern.
 * @returns {number} Wildcard, suffix-wildcard or exact-host priority.
 */
const getMultisiteHostPriority = (host: string) => {
  if (host === '*') {
    return 0;
  }
  if (host.startsWith('*.')) {
    return 1;
  }
  return 2;
};

/** Count normalized nonempty URL segments for explicit multisite precedence.
 * @param {string} pathname - Authored registered path.
 * @returns {number} Path specificity count.
 */
const countPathSegments = (pathname: string) =>
  sanitizePathname(pathname).split('/').filter(Boolean).length;

/** Validate one explicit app-root folder segment without accepting traversal or nested paths.
 * @param {string} folderName - Trusted authored multisite folder.
 * @returns {string} Validated normalized single folder name.
 */
const normalizeMultisiteFolder = (folderName: string) => {
  /** Validated stage-local normalized folder or safe response-error projection. */
  const normalized = folderName.trim().replace(/^\/+|\/+$/g, '');

  if (
    !normalized ||
    normalized.includes('/') ||
    normalized === '.' ||
    normalized === '..'
  ) {
    throw new Error(
      `Invalid multisite folder name "${folderName}". Use a single root app folder segment.`
    );
  }

  if (!/^[a-zA-Z0-9._~{}[\]-]+$/.test(normalized)) {
    throw new Error(
      `Invalid multisite folder name "${folderName}". Use URL-safe characters only.`
    );
  }

  return normalized;
};

/** Parse an explicit authored multisite URL/host registration without deriving trust from forwarded headers.
 * @param {string} value - Trusted host/path registration.
 * @returns {{host: string; pathname: string}} Normalized registration host and path.
 */
const parseMultisiteUrl = (value: string) => {
  /** Trimmed explicit multisite URL/host registration. */
  const input = value.trim();
  if (!input) {
    throw new Error('multisiteRegister requires a non-empty url.');
  }

  /** Parsed authored registration or current request URL; origin trust is enforced separately. */
  const url = new URL(input.includes('://') ? input : `http://${input}`);

  return {
    host: normalizeHost(url.host),
    pathname: sanitizePathname(url.pathname),
  };
};

/** Capture explicit normalized multisite host/path/folder precedence metadata.
 * @param {string} url - Authored host/path registration.
 * @param {string} folderName - Validated single application folder.
 * @param {number} order - Stable registration order for equal specificity.
 * @returns {MultisiteRegistration} Captured registration descriptor.
 */
const createMultisiteRegistration = (
  url: string,
  folderName: string,
  order: number
): MultisiteRegistration => {
  /** Parsed authored URL/file components used for path derivation. */
  const parsed = parseMultisiteUrl(url);

  return {
    url,
    folderName: normalizeMultisiteFolder(folderName),
    host: parsed.host,
    pathname: parsed.pathname,
    pathSize: countPathSegments(parsed.pathname),
    order,
  };
};

/** Match an explicit path prefix only at a slash boundary.
 * @param {string} registeredPath - Normalized authored mount path.
 * @param {string} pathname - Normalized incoming path.
 * @returns {boolean} Whether the registration covers this path.
 */
const matchesMultisitePath = (registeredPath: string, pathname: string) => {
  if (registeredPath === '/') {
    return true;
  }
  return (
    pathname === registeredPath || pathname.startsWith(`${registeredPath}/`)
  );
};

/** Match only the authored exact, suffix-wildcard or universal host policy.
 * @param {string} registeredHost - Authored host pattern.
 * @param {string} host - Already admitted normalized request host.
 * @returns {boolean} Whether this explicit registration matches.
 */
const matchesMultisiteHost = (registeredHost: string, host: string) => {
  if (registeredHost === '*') {
    return true;
  }

  if (registeredHost.startsWith('*.')) {
    /** Host suffix or matched path remainder retained by the current multisite operation. */
    const suffix = registeredHost.slice(1);
    return host.endsWith(suffix) && host.length > suffix.length;
  }

  return registeredHost === host;
};

/** Select explicit multisite registration by path/host specificity and preserve stable registration ties.
 * @param {string} host - Admitted native request host.
 * @param {string} pathname - Normalized incoming path.
 * @param {MultisiteRegistration[]} registrations - Request-authored explicit registrations.
 * @returns {object | null} Selected app-folder path projection, otherwise null.
 */
const applyMultisitePath = (
  host: string,
  pathname: string,
  registrations: MultisiteRegistration[]
) => {
  /** Admitted request host normalized for explicit multisite selection. */
  const normalizedHost = normalizeHost(host);
  /** Slash-normalized path used by registered route/multisite matching. */
  const normalizedPathname = sanitizePathname(pathname);
  /** Current explicit route or multisite match; no caller-supplied handler is executed. */
  const match = [...registrations]
    .sort(
      (left, right) =>
        right.pathSize - left.pathSize ||
        right.pathname.length - left.pathname.length ||
        getMultisiteHostPriority(right.host) -
          getMultisiteHostPriority(left.host) ||
        left.order - right.order
    )
    .find(
      (registration) =>
        matchesMultisiteHost(registration.host, normalizedHost) &&
        matchesMultisitePath(registration.pathname, normalizedPathname)
    );

  if (!match) {
    return null;
  }

  /** Host suffix or matched path remainder retained by the current multisite operation. */
  const suffix =
    match.pathname === '/'
      ? normalizedPathname
      : normalizedPathname.slice(match.pathname.length);

  return {
    registration: match,
    pathname: sanitizePathname(
      `/${match.folderName}${suffix === '/' ? '' : suffix}`
    ),
  };
};

/** Recognize a leading dynamic route segment for multisite-miss privacy fencing.
 * @param {DiscoveredRoute} route - Trusted discovered route descriptor.
 * @returns {boolean} Whether the root segment is dynamic.
 */
const isRootDynamicRoute = (route: DiscoveredRoute) => {
  /** First normalized route segment used for the multisite-miss guard. */
  const [firstSegment] = route.pattern.split('/').filter(Boolean);
  return Boolean(firstSegment?.startsWith(':'));
};

/** Look up an authored local file extension in the package MIME catalog.
 * @param {string} filePath - Local public file path.
 * @returns {string} Catalog MIME value or the opaque binary fallback.
 */
const getContentType = (filePath: string) => {
  /** Lowercase local filename extension including its optional dot. */
  const extParts = path.extname(filePath).toLowerCase();
  /** Catalog extension key without a leading dot. */
  const lookupKey = extParts.startsWith('.') ? extParts.slice(1) : extParts;
  return MIME_TYPES[lookupKey] || 'application/octet-stream';
};

/** Legacy buffered native request ceiling: one mebibyte, independent of streamBody routes. */
const MAX_REQUEST_BODY_BYTES = 1024 * 1024; // Default limit: 1 MiB.
/** Collect only the legacy bounded buffered request path; streamBody endpoints retain their own readers.
 * @param {IncomingMessage} req - Borrowed native request stream.
 * @returns {Promise<Buffer>} Bounded body bytes or explicit size/abort failure.
 */
const readRequestBody = async (req: IncomingMessage): Promise<Buffer> =>
  new Promise<Buffer>((resolve, reject) => {
    /** Bounded buffered native request chunks. */
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    /** Reject this request-body receipt at most once; native request ownership remains outside the reader.
     * @param {Error} error - Private read/size/abort failure.
     * @returns {void} Body receipt rejection completion.
     */
    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };
    /** Native declared body length used only for early size rejection. */
    const declaredLength = Number(req.headers['content-length']);
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_REQUEST_BODY_BYTES
    ) {
      fail(
        Object.assign(new Error('Request body exceeds 1 MiB'), {
          statusCode: 413,
        })
      );
      req.resume();
      return;
    }
    req.on('data', (chunk: Buffer | string) => {
      if (settled) {
        return;
      }
      /** Actual request chunk or explicit cache payload prepared for byte policy. */
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += data.length;
      if (size > MAX_REQUEST_BODY_BYTES) {
        fail(
          Object.assign(new Error('Request body exceeds 1 MiB'), {
            statusCode: 413,
          })
        );
        req.pause();
        return;
      }
      chunks.push(data);
    });
    req.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks, size));
      }
    });
    req.on('error', fail);
    req.on('aborted', () => fail(new Error('Request aborted')));
  });

/** Update authored HTML root theme classes/color-scheme while preserving unrelated root attributes.
 * @param {string} html - Trusted authored HTML document string.
 * @param {string} mode - Supported selected preference.
 * @param {string} resolvedColorScheme - Concrete light/dark scheme.
 * @returns {string} Legacy theme-decorated document; this does not sanitize arbitrary HTML.
 */
const presetHtmlTheme = (
  html: string,
  mode: string,
  resolvedColorScheme: 'light' | 'dark'
): string => {
  /** Successful authored HTML-root attribute capture; absent root leaves the string unchanged. */
  const htmlMatch = html.match(/<html\b([^>]*)>/i);
  if (!htmlMatch) {
    return html;
  }

  // Successful HTML-tag matching always supplies the attribute capture, including empty text.
  let attrs = htmlMatch[1]!;
  /** Fixed selected preference/concrete scheme classes. */
  const themeClasses =
    mode === 'system' ? ['system', resolvedColorScheme] : [mode];

  /** Authored root class attribute matched without executing HTML. */
  const classMatch = attrs.match(/\bclass=("[^"<>]*"|'[^'<>]*')/i);
  if (classMatch) {
    /** Original root attribute quote retained during replacement. */
    const quote = classMatch[1]![0]!;
    /** Authored root classes excluding only managed theme modes. */
    const existingClasses = classMatch[1]!
      .slice(1, -1)
      .split(/\s+/)
      .filter(
        (item) =>
          item && item !== 'light' && item !== 'dark' && item !== 'system'
      );
    /** Replacement class attribute retaining unrelated authored classes. */
    const newClassAttr = `class=${quote}${[...existingClasses, ...themeClasses].join(' ')}${quote}`;
    attrs = attrs.replace(/\bclass=("[^"<>]*"|'[^'<>]*')/i, newClassAttr);
  } else {
    attrs += ` class="${themeClasses.join(' ')}"`;
  }

  /** Authored root inline style attribute match. */
  const styleMatch = attrs.match(/\bstyle=("[^"<>]*"|'[^'<>]*')/i);
  if (styleMatch) {
    /** Original root attribute quote retained during replacement. */
    const quote = styleMatch[1]![0]!;
    /** Authored inline declarations with only existing color-scheme removed. */
    const existingStyle = styleMatch[1]!
      .slice(1, -1)
      .replace(/color-scheme\s*:\s*[^;]+;?/gi, '')
      .trim()
      .replace(/;?$/, ';')
      .replace(/^;$/, '');
    /** Concrete color-scheme declaration appended to unrelated authored inline styles. */
    const style = `${existingStyle ? `${existingStyle} ` : ''}color-scheme: ${resolvedColorScheme};`;
    /** Replacement style attribute preserving its authored quote. */
    const newStyleAttr = `style=${quote}${style}${quote}`;
    attrs = attrs.replace(/\bstyle=("[^"<>]*"|'[^'<>]*')/i, newStyleAttr);
  } else {
    attrs += ` style="color-scheme: ${resolvedColorScheme};"`;
  }

  return html.replace(/<html\b[^>]*>/i, `<html ${attrs.trim()}>`);
};

/** Decorate the legacy authored document and inject only the fixed trusted theme bootstrap with inert encoded settings.
 * @param {string} html - Trusted authored HTML result.
 * @param {ZeruxRequestContext} context - Explicit request-local theme configuration/cookies.
 * @returns {string} Legacy decorated document; strict renderer security paths remain separate.
 */
const processThemeHtml = (
  html: string,
  context: ZeruxRequestContext
): string => {
  /** Resolved request-local host theme policy. */
  const themeConfig = getThemeConfig(context.config);
  /** Validated request-local cookie/default preference. */
  const mode = getThemeMode(context);
  /** Concrete request-local media/client-hint scheme. */
  const colorScheme = getResolvedTheme(mode, context);
  let updatedHtml = presetHtmlTheme(html, mode, colorScheme);
  /** Fixed trusted package-authored browser bootstrap; host settings are encoded separately as inert data. */
  const scriptContent = `(function () {
  var element = document.querySelector("script[data-zerux-theme]"),
    settings = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(
          atob(element.getAttribute("data-zerux-theme")),
          function (c) {
            return c.charCodeAt(0);
          },
        ),
      ),
    ),
    name = settings.cookieName,
    def = settings.default,
    theme = def,
    cookies = document.cookie.split(";");
  for (var i = 0; i < cookies.length; i++) {
    var c = cookies[i].trim();
    if (c.indexOf(name + "=") === 0) {
      theme = decodeURIComponent(c.substring(name.length + 1));
      break;
    }
  }
  if (theme !== "light" && theme !== "dark" && theme !== "system") theme = def;
  var doc = document.documentElement;
  function apply() {
    var resolved =
      theme === "system" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : theme === "dark"
          ? "dark"
          : "light";
    doc.classList.remove("light", "dark", "system");
    doc.classList.add(theme);
    if (theme === "system") doc.classList.add(resolved);
    doc.style.colorScheme = resolved;
  }
  apply();
  if (window.matchMedia) {
    var media = window.matchMedia("(prefers-color-scheme: dark)");
    var listener = function () {
      if (theme === "system") apply();
    };
    if (media.addEventListener) media.addEventListener("change", listener);
    else if (media.addListener) media.addListener(listener);
  }
})();`;
  // Configuration is inert base64 UTF-8 data, never interpolated into JS source.
  /** Base64 UTF-8 JSON settings, never interpolated as JavaScript source. */
  const settings = Buffer.from(
    JSON.stringify({
      cookieName: themeConfig.cookieName,
      default: themeConfig.default,
    })
  ).toString('base64');
  /** Authored supported script attributes and inert encoded settings. */
  const scriptAttrs = [
    `data-zerux-theme="${settings}"`,
    themeConfig.scriptType === 'module' ? `type="module"` : 'nomodule',
    themeConfig.scriptLoadType,
  ];
  /** Fixed trusted bootstrap markup surrounding the encoded settings and authored script. */
  const scriptTag = `<script ${scriptAttrs.join(' ')}>${scriptContent}</script>`;

  if (themeConfig.scriptPosition === 'head') {
    updatedHtml = updatedHtml.replace(
      /(<head\b[^>]*>)/i,
      (_match, opening: string) => opening + scriptTag
    );
  } else if (themeConfig.scriptPosition === 'body-top') {
    updatedHtml = updatedHtml.replace(
      /(<body\b[^>]*>)/i,
      (_match, opening: string) => opening + scriptTag
    );
  } else {
    updatedHtml = updatedHtml.replace(
      /(<\/body>)/i,
      (closing: string) => scriptTag + closing
    );
  }

  return updatedHtml;
};

/** Merge explicit client-hint negotiation headers only before native commitment.
 * @param {ServerResponse} res - Borrowed native response.
 * @param {ZeruxConfig} config - Private host theme settings.
 * @returns {void} Header update or no operation when disabled/committed.
 */
const setThemePreferenceHeaders = (
  res: ServerResponse,
  config: ZeruxConfig
) => {
  /** Resolved request-local host theme policy. */
  const themeConfig = getThemeConfig(config);
  if (themeConfig.disablePrefrenceHeader || res.headersSent) {
    return;
  }

  /** Fixed supported browser color-scheme client hint. */
  const preferenceHeader = 'Sec-CH-Prefers-Color-Scheme';
  /** Borrowed existing Vary header before adding the theme hint dimension. */
  const currentVary = res.getHeader('Vary');
  /** Existing nonempty Vary dimensions retained during legacy theme negotiation. */
  const varyValues = new Set(
    (Array.isArray(currentVary)
      ? currentVary.join(',')
      : String(currentVary ?? '')
    )
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );

  varyValues.add(preferenceHeader);
  res.setHeader('Accept-CH', preferenceHeader);
  res.setHeader('Critical-CH', preferenceHeader);
  res.setHeader('Vary', [...varyValues].join(', '));
  res.setHeader('Permissions-Policy', 'ch-prefers-color-scheme=*');
};

/** Send an explicit handler result using existing stream, cache-validator, redirect, HTML and HEAD ownership paths.
 * @param {ServerResponse} res - Borrowed native response.
 * @param {unknown} payload - Trusted handler result; untrusted content requires its own validation/escaping.
 * @param {number} statusCode - Explicit native response status, default 200.
 * @param {ZeruxRequestContext | undefined} context - Optional request-local cache/theme/negotiation context.
 * @returns {Promise<void>} Response scheduling/stream settlement under the selected result contract.
 */
const sendResponse = async (
  res: ServerResponse,
  payload: unknown,
  statusCode = 200,
  context?: ZeruxRequestContext
) => {
  if (res.writableEnded) {
    return;
  }
  if (
    statusCode >= 400 &&
    context &&
    (acceptsApiError(context.req.headers.accept) ||
      context.state.zeruxApiError === true)
  ) {
    payload = normalizeApiError(new ApplicationError(statusCode)).body;
    res.setHeader('cache-control', 'no-store');
    res.setHeader('vary', 'Accept');
  }

  if (isCached(payload)) {
    applyCachePolicy(res, payload.policy);
    if (payload.policy.etag && context) {
      /** Actual request chunk or explicit cache payload prepared for byte policy. */
      const data = payload.value;
      if (!isStream(data) && !isRedirectResponse(data) && data !== undefined) {
        /** Exact selected cached representation bytes used for conditional ETag evaluation. */
        const bytes = Buffer.isBuffer(data)
          ? data
          : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
        if (conditionalEtag(context.req, res, bytes)) {
          return;
        }
      }
    }
    payload = payload.value;
  }
  if (isRenderedHtml(payload)) {
    for (const [key, value] of Object.entries(payload.headers ?? {})) {
      res.setHeader(key, value);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (context?.req.method === 'HEAD') {
      res.setHeader('Content-Length', Buffer.byteLength(payload.html));
      res.end();
    } else {
      res.end(payload.html);
    }
    return;
  }
  if (isStream(payload)) {
    await sendStream(res, payload, context?.req);
    return;
  }
  if (isRedirectResponse(payload)) {
    res.setHeader('Location', payload.location);
    res.writeHead(payload.statusCode);
    res.end();
    return;
  }

  if (payload === undefined) {
    res.statusCode = statusCode;
    res.end();
    return;
  }

  if (Buffer.isBuffer(payload)) {
    res.statusCode = statusCode;
    if (context?.req.method === 'HEAD') {
      res.setHeader('Content-Length', payload.byteLength);
      res.end();
    } else {
      res.end(payload);
    }
    return;
  }

  if (typeof payload === 'string') {
    let finalPayload = payload;
    if (context && looksLikeHtml(payload)) {
      try {
        finalPayload = processThemeHtml(payload, context);
      } catch {
        // Preserve the legacy authored payload when theme decoration cannot complete.
      }
    }
    res.statusCode = statusCode;
    res.setHeader(
      'Content-Type',
      looksLikeHtml(finalPayload)
        ? 'text/html; charset=utf-8'
        : 'text/plain; charset=utf-8'
    );
    if (context?.req.method === 'HEAD') {
      res.setHeader('Content-Length', Buffer.byteLength(finalPayload));
      res.end();
    } else {
      res.end(finalPayload);
    }
    return;
  }

  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  /** JSON response text computed once for native HEAD/body handling. */
  const serialized = JSON.stringify(payload);
  if (context?.req.method === 'HEAD') {
    res.setHeader('Content-Length', Buffer.byteLength(serialized));
    res.end();
  } else {
    res.end(serialized);
  }
};

/** Map an authored route file path to the existing static/dynamic/catch-all grammar without importing it.
 * @param {string} appDir - Trusted route discovery root.
 * @param {string} filePath - Authored route module path.
 * @returns {string} Derived normalized route pattern.
 */
const routePathFromFile = (appDir: string, filePath: string) => {
  /** Project- or discovery-root-relative source/public path for this stage. */
  const relativePath = toPosixPath(path.relative(appDir, filePath));
  /** Parsed authored URL/file components used for path derivation. */
  const parsed = path.parse(relativePath);
  /** Authored route directory/leaf segments before URL grammar mapping. */
  const parts = parsed.dir ? parsed.dir.split('/') : [];

  if (!RESERVED_ROUTE_FILE_NAMES.has(parsed.name)) {
    parts.push(parsed.name);
  }

  /** Explicit nonstructural route segments with dynamic/catch-all aliases. */
  const segments = parts
    .filter(Boolean)
    .map((segment) => {
      if (segment === 'index' || segment === 'page' || segment === 'route') {
        return null;
      }
      if (segment.startsWith('[...') && segment.endsWith(']')) {
        return `:${segment.slice(4, -1)}*`;
      }
      if (segment.startsWith('[') && segment.endsWith(']')) {
        return `:${segment.slice(1, -1)}`;
      }
      return segment;
    })
    .filter((segment): segment is string => Boolean(segment));

  return segments.length ? `/${segments.join('/')}` : '/';
};

/** Apply the shared deterministic route specificity ordering in place.
 * @param {DiscoveredRoute[]} routes - Generation-owned route list.
 * @returns {DiscoveredRoute[]} Same sorted route array.
 */
const sortRoutes = (routes: DiscoveredRoute[]) =>
  routes.sort(compareRoutePatterns);

/** Send explicitly discovered public file bytes with catalog MIME metadata.
 * @param {ServerResponse} res - Borrowed native response.
 * @param {string} filePath - Host-discovered public file path.
 * @returns {void} Native response write scheduling completion.
 */
const serveStaticFile = (res: ServerResponse, filePath: string) => {
  /** Actual local public-file bytes sent by the legacy synchronous path. */
  const content = fs.readFileSync(filePath);
  res.statusCode = 200;
  res.setHeader('Content-Type', getContentType(filePath));
  res.setHeader('Content-Length', content.length);
  res.end(content);
};

/** Import only explicitly configured trusted server discovery roots and retain private source orientation.
 * @param {string} rootDir - Trusted project root.
 * @param {string[]} directories - Explicit host discovery directories.
 * @param {RuntimeMode} mode - Runtime module-loading mode.
 * @returns {Promise<LoadedModule<T>[]>} Loaded trusted module descriptors; arbitrary request strings never select imports.
 */
const loadModulesFromDirectories = async <T = any>(
  rootDir: string,
  directories: string[],
  mode: RuntimeMode
): Promise<LoadedModule<T>[]> => {
  /** Explicit trusted server modules retained in discovery order. */
  const loadedModules: LoadedModule<T>[] = [];

  for (const directoryPath of directories) {
    for (const filePath of walkDirectory(directoryPath)) {
      /** Trusted native module namespace from the configured discovery path. */
      const exports = (await importModule(filePath, mode)) as T;
      loadedModules.push({
        key: toKey(rootDir, filePath),
        absolutePath: filePath,
        relativePath: toPosixPath(path.relative(rootDir, filePath)),
        exports,
      });
    }
  }

  return loadedModules;
};

/** Collect explicit public source roots with configured overlap precedence, without inventing runtime/source exposure.
 * @param {string} rootDir - Trusted project root retained by this compatibility signature.
 * @param {string[]} publicDirs - Explicit host public directories.
 * @returns {Map<string, string>} Public URL-to-local-file lookup.
 */
const collectPublicFiles = (rootDir: string, publicDirs: string[]) => {
  /** Explicit public URL lookup; private service configuration is not added to it. */
  const publicFiles = new Map<string, string>();

  for (const publicDir of publicDirs) {
    if (!fs.existsSync(publicDir) || !fs.statSync(publicDir).isDirectory()) {
      continue;
    }

    /** Local directory scan stack for the explicit public roots. */
    const stack = [publicDir];
    while (stack.length) {
      /** Next explicit public directory being inspected. */
      const currentDir = stack.pop()!;
      for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
        /** Local discovered public entry path. */
        const absolutePath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          stack.push(absolutePath);
          continue;
        }

        /** Project- or discovery-root-relative source/public path for this stage. */
        const relativePath = toPosixPath(
          path.relative(publicDir, absolutePath)
        );
        publicFiles.set(`/${relativePath}`, absolutePath);
      }
    }
  }

  return publicFiles;
};

/** Resolve only trusted function exports or registered controller/action references.
 * @param {unknown} reference - Authored handler/function or controller reference.
 * @param {Map<string, unknown>} controllers - Trusted generation controller registry.
 * @returns {RouteHandler | null} Registered callable handler, otherwise null.
 */
const resolveHandlerReference = (
  reference: unknown,
  controllers: Map<string, unknown>
): RouteHandler | null => {
  if (typeof reference === 'function') {
    return reference as RouteHandler;
  }

  if (typeof reference !== 'string') {
    return null;
  }

  /** Authored controller key and optional action name from the compatible reference syntax. */
  const [controllerKey, actionName] = reference.split('#');
  /** Trusted registered controller value selected by an authored reference. */
  const controller = controllers.get(controllerKey!);
  if (!controller) {
    return null;
  }

  if (!actionName && typeof controller === 'function') {
    return controller as RouteHandler;
  }

  if (controller && typeof controller === 'object' && actionName) {
    /** Explicit registered controller action value, required to be callable. */
    const action = (controller as Record<string, unknown>)[actionName];
    if (typeof action === 'function') {
      return action as RouteHandler;
    }
  }

  return null;
};

/** Discover trusted route modules, skipping exact client declarations before development-time execution.
 * @param {string} rootDir - Trusted project root.
 * @param {string | null} appDir - Explicit authored route directory.
 * @param {RuntimeMode} mode - Server module-loading mode.
 * @param {Map<string, MiddlewareFunction>} middleware - Registered trusted middleware authority.
 * @param {Map<string, unknown>} controllers - Registered trusted controller authority.
 * @returns {Promise<DiscoveredRoute[]>} Deterministically ordered trusted route descriptors.
 */
const discoverRoutes = async (
  rootDir: string,
  appDir: string | null,
  mode: RuntimeMode,
  middleware: Map<string, MiddlewareFunction>,
  controllers: Map<string, unknown>
): Promise<DiscoveredRoute[]> => {
  if (!appDir || !fs.existsSync(appDir) || !fs.statSync(appDir).isDirectory()) {
    return [];
  }

  /** Generation-owned discovered/registered handler descriptors; never a browser manifest. */
  const routes: DiscoveredRoute[] = [];

  for (const filePath of walkDirectory(appDir)) {
    /** Project- or discovery-root-relative source/public path for this stage. */
    const relativePath = path.relative(appDir, filePath);
    if (
      relativePath.startsWith('middleware') ||
      relativePath.startsWith('controllers') ||
      relativePath.startsWith('composables')
    ) {
      continue;
    }

    if (mode === 'dev') {
      /** Authored module text used only for syntax-based client exclusion before import. */
      const source = fs.readFileSync(filePath, 'utf8');
      if (
        source.includes('use client') ||
        /\.client\.[cm]?[jt]sx?$/.test(filePath)
      ) {
        /** Host TypeScript parser used only when client directive syntax needs inspection. */
        const parser = await loadBuildParser(rootDir);
        if (isClientModuleSource(parser, filePath, source)) {
          continue;
        }
      }
    }
    /** Trusted route module namespace from the explicit discovery path. */
    const loaded = await importModule(filePath, mode);
    /** Authored routePath/path override or derived file route grammar. */
    let declaredPattern: string;
    if (typeof loaded.routePath === 'string') {
      declaredPattern = loaded.routePath;
    } else if (typeof loaded.path === 'string') {
      declaredPattern = loaded.path;
    } else {
      declaredPattern = routePathFromFile(appDir, filePath);
    }

    /** Explicit supported method-to-trusted-handler projection. */
    const methods: Partial<Record<string, RouteHandler>> = {};
    for (const method of HTTP_METHODS) {
      /** Trusted module/route handler selected by explicit registration and method. */
      const handler = loaded[method];
      if (typeof handler === 'function') {
        methods[method] = handler as RouteHandler;
      }
    }

    /** Compatible authored default/handler/route export before controller reference resolution. */
    const directHandler = extractModuleValue<RouteHandler | string>(loaded, [
      'default',
      'handler',
      'route',
    ]);

    if (Object.keys(methods).length === 0 && directHandler !== null) {
      /** Callable registered controller/handler reference, never evaluated source strings. */
      const resolved = resolveHandlerReference(directHandler, controllers);
      if (resolved) {
        methods.ALL = resolved;
      }
    }

    if (
      Object.keys(methods).length === 0 &&
      typeof loaded.controller === 'string'
    ) {
      /** Callable registered controller/handler reference, never evaluated source strings. */
      const resolved = resolveHandlerReference(loaded.controller, controllers);
      if (resolved) {
        /** Normalized authored/native HTTP method used only to select registered handlers. */
        const method = normalizeMethod(loaded.method);
        methods[method] = resolved;
      }
    }

    /** Explicit authored middleware names attached to this route. */
    const routeMiddleware = asArray<string>(loaded.middleware);
    if (Object.keys(methods).length === 0) {
      continue;
    }

    routes.push({
      id: toKey(rootDir, filePath),
      absolutePath: filePath,
      relativePath: toPosixPath(path.relative(rootDir, filePath)),
      pattern: sanitizePathname(declaredPattern),
      methods,
      middleware: routeMiddleware,
      meta: typeof loaded.meta === 'object' ? loaded.meta : undefined,
    });
  }

  return sortRoutes(routes);
};

/** Match the shared anchored route grammar and preserve method-missing versus path-missing outcomes.
 * @param {DiscoveredRoute[]} routes - Trusted specificity-ordered route descriptors.
 * @param {string} pathname - Candidate normalized path.
 * @param {string} method - Normalized native method.
 * @returns {object | null} Matched route/captures/optional handler, otherwise null.
 */
const matchRoute = (
  routes: DiscoveredRoute[],
  pathname: string,
  method: string
) => {
  /** Slash-normalized path used by registered route/multisite matching. */
  const normalizedPathname = sanitizePathname(pathname);

  for (const route of routes) {
    /** Shared anchored route regex and named capture metadata. */
    const compiled = compileRoutePattern(route.pattern);
    /** Anchored shared-grammar captures for this trusted registered route. */
    const match = compiled.regex.exec(normalizedPathname);
    if (!match) {
      continue;
    }

    /** Trusted module/route handler selected by explicit registration and method. */
    const handler = route.methods[method] || route.methods.ALL;
    if (!handler) {
      return {
        route,
        params: match.groups ?? {},
        handler: null,
      };
    }

    return {
      route,
      params: match.groups ?? {},
      handler,
    };
  }

  return null;
};

/** Prepare one generation’s trusted registrations and request dispatch; clean candidate-owned resources on preparation failure.
 * @param {string} rootDir - Trusted project root.
 * @param {RuntimeMode} mode - Explicit server mode.
 * @param {ZeruxConfig} config - Private validated runtime settings.
 * @param {ResolvedStructure} structure - Explicit resolved discovery paths.
 * @param {RuntimeServiceScope} serviceScope - Prepared generation-owned service scope.
 * @param {Function} notifyGeneration - Metadata-only host lifecycle notifier.
 * @returns {Promise<ZeruxRuntime>} Prepared generation runtime with explicit activation/shutdown.
 */
const createRuntime = async (
  rootDir: string,
  mode: RuntimeMode,
  config: ZeruxConfig,
  structure: ResolvedStructure,
  serviceScope: RuntimeServiceScope,
  notifyGeneration: (
    phase: Extract<keyof ServerLifecycleEvents, `generation:${string}`>
  ) => void
): Promise<ZeruxRuntime> => {
  /** Generation-local trusted middleware registry. */
  const middleware = new Map<string, MiddlewareFunction>();
  /** Owned generation renderer authority drained before dependent services close. */
  const rendererRegistry = createRendererRegistry();
  /** Discovery-order global middleware names, deduplicated at dispatch. */
  const globalMiddleware: string[] = [];
  /** Generation-local trusted controller registry. */
  const controllers = new Map<string, unknown>();
  /** Generation-local trusted composable values. */
  const composables = new Map<string, unknown>();
  /** Explicit startup worker descriptors; activation owns when they execute. */
  const workers = new Map<string, ReturnType<typeof normalizeWorker>>();
  /** Generation-local worker mutable state. */
  const workerState = new Map<string, unknown>();
  /** Registered trusted native thread pools, stopped by the surrounding worker lifecycle owner. */
  const threadWorkers = new Map<string, ThreadWorkerPool>();
  /** Generation-owned discovered/registered handler descriptors; never a browser manifest. */
  const routes: DiscoveredRoute[] = [];
  /** Explicit public URL lookup; private service configuration is not added to it. */
  const publicFiles = collectPublicFiles(rootDir, structure.publicDirs);
  /** Explicit host opt-in to request-local multisite registration. */
  const multisiteEnabled = config.multisite === true;
  /** Bounded generation-local HTTP measurements without URL/user labels. */
  const httpMetrics = new ApplicationHttpMetrics();
  /** Owned operational request observer; private causes stay out of public responses. */
  const observer = createRequestObserver(config.observability);
  delete config.observability;
  /** Borrowed private host lifecycle authority removed from runtime public settings. */
  const lifecycleHooks = config.lifecycleHooks;
  delete config.lifecycleHooks;
  /** Owned bridge whose request scopes terminate at native response finish/close. */
  const lifecycle = createServerLifecycleBridge(
    observer.generationId,
    lifecycleHooks,
    observer.report
  );
  let closePromise: Promise<void> | undefined,
    activated = false;
  let runtimeClosed = false;
  // Each generation owns its registered template values; the global singleton
  // is only a backwards-compatible convenience, never an app boundary.
  /** Generation-owned template variable registry, distinct from process compatibility convenience state. */
  const variableRegistry = createVariableRegistry();
  /** Bounded explicit plugin resource cleanup receipts in acquisition order. */
  const pluginDisposers: (() => void | Promise<void>)[] = [];
  /** Run every registered plugin disposer in reverse order without dropping later cleanup after a failure.
   * @returns {Promise<void>} Actual plugin cleanup settlement with aggregated failures.
   */
  const disposePlugins = async () => {
    /** Private cleanup causes accumulated while all remaining owned releases run. */
    const errors: unknown[] = [];
    for (const dispose of pluginDisposers.splice(0).reverse()) {
      try {
        await dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) {
      throw new AggregateError(errors, 'Plugin cleanup failed');
    }
  };
  let routesSealed = false;
  let appProtocols: ZeruxProtocols | undefined;
  /** Lazily create explicit generation protocol ownership only when enabled and requested.
   * @returns {ZeruxProtocols} Generation-bound protocol registration facade.
   */
  const protocols = () => {
    if (config.protocols?.enabled === false) {
      throw new Error('Application protocols are disabled');
    }
    return (appProtocols ??= createZeruxProtocols(config.protocols));
  };

  try {
    /** Trusted modules loaded only from explicit middleware roots. */
    const middlewareModules = await loadModulesFromDirectories(
      rootDir,
      structure.middlewareDirs,
      mode
    );
    for (const module of middlewareModules) {
      /** Compatible callable middleware export selected from a trusted module. */
      const fn = extractModuleValue<MiddlewareFunction>(module.exports, [
        'default',
        'middleware',
        'handle',
      ]);

      if (typeof fn === 'function') {
        middleware.set(module.key, fn);
        /** Compatible leaf-name alias for an explicitly discovered middleware registration. */
        const shortKey = path.basename(module.key);
        middleware.set(shortKey, fn);
        globalMiddleware.push(shortKey);
      }
    }

    /** Trusted controller modules loaded from explicit controller roots. */
    const controllerModules = await loadModulesFromDirectories(
      rootDir,
      structure.controllerDirs,
      mode
    );
    for (const module of controllerModules) {
      /** Trusted default/module value captured without serializing it to a browser. */
      const exported = module.exports.default ?? module.exports;
      controllers.set(module.key, exported);
      controllers.set(path.basename(module.key), exported);
    }

    /** Trusted composable modules loaded from explicit roots. */
    const composableModules = await loadModulesFromDirectories(
      rootDir,
      structure.composableDirs,
      mode
    );
    for (const module of composableModules) {
      /** Trusted default/module value captured without serializing it to a browser. */
      const exported = module.exports.default ?? module.exports;
      composables.set(module.key, exported);
      composables.set(path.basename(module.key), exported);
    }

    let runtime!: ZeruxRuntime;

    /** Trusted generation registration/lookup authority; never public client configuration. */
    const pluginApi: ZeruxPluginApi = {
      renderers: () => rendererRegistry,
      lifecycleHooks: () => lifecycleHooks,
      /** Project only explicitly opted-in GET routes into the validated public manifest; handlers and private sources remain server-owned.
       * @param {Parameters<ZeruxPluginApi['navigationManifest']>[0]} options - Explicit base/asset/boundary public projection policy.
       * @returns {ReturnType<ZeruxPluginApi['navigationManifest']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      navigationManifest(options) {
        return createPublicRouteManifest({
          ...options,
          routes: routes
            .filter((route) => route.methods.GET || route.methods.ALL)
            .filter((route) => route.meta?.navigation !== undefined)
            .map((route) => ({
              ...(route.meta!
                .navigation as import('../navigation-manifest.js').NavigationRouteMetadata),
              pattern: route.pattern,
            })),
        });
      },
      /** Retain one bounded trusted plugin cleanup receipt for candidate failure and generation shutdown.
       * @param {Parameters<ZeruxPluginApi['onDispose']>[0]} cleanup - Trusted disposer returning actual asynchronous settlement when needed.
       * @returns {ReturnType<ZeruxPluginApi['onDispose']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      onDispose(cleanup) {
        if (
          typeof cleanup !== 'function' ||
          runtimeClosed ||
          pluginDisposers.length >= 128
        ) {
          throw new Error('Invalid plugin cleanup');
        }
        pluginDisposers.push(cleanup);
      },
      /** Check exact normalized pattern/method registration presence without authorizing access.
       * @param {Parameters<ZeruxPluginApi['hasRoute']>[0]} pattern - Authored route pattern.
       * @param {Parameters<ZeruxPluginApi['hasRoute']>[1]} method - Explicit HTTP method.
       * @returns {ReturnType<ZeruxPluginApi['hasRoute']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      hasRoute(pattern, method) {
        return routes.some(
          (route) =>
            route.pattern === sanitizePathname(pattern) &&
            route.methods[normalizeMethod(method)] !== undefined
        );
      },
      protocols,
      service: (name) => serviceScope.get(name),
      variables: () => variableRegistry,
      getLoadStatus: (windowMs) => httpMetrics.snapshot(windowMs),
      /** Register trusted handler code while preserving reserved service endpoint ownership and explicit middleware metadata.
       * @param {Parameters<ZeruxPluginApi['addRoute']>[0]} route - Authored route descriptor, never executable browser input.
       * @returns {ReturnType<ZeruxPluginApi['addRoute']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      addRoute(route) {
        if (
          !route ||
          typeof route.pattern !== 'string' ||
          !route.pattern.startsWith('/') ||
          typeof route.handler !== 'function'
        ) {
          throw new TypeError('Invalid application route');
        }
        /** Validated supported method used for route registration and lookup. */
        const normalizedMethod = normalizeMethod(route.method);
        if (!HTTP_METHODS.includes(normalizedMethod as HttpMethod)) {
          throw new TypeError('Unsupported HTTP method');
        }
        if (
          routesSealed &&
          serviceScope
            .httpRoutes()
            .some((item) =>
              serviceRouteOverlaps(
                item.pattern,
                sanitizePathname(route.pattern)
              )
            )
        ) {
          throw new Error(
            `Reserved service endpoint cannot be replaced: ${route.pattern}`
          );
        }
        /** Existing authored route descriptor checked against reserved service ownership. */
        const existing = routes.find(
          (item) => item.pattern === sanitizePathname(route.pattern)
        );
        /** Trusted module/route handler selected by explicit registration and method. */
        const handler = route.handler;

        if (existing) {
          if (
            existing.id.startsWith('service:') &&
            route.source !== existing.id
          ) {
            throw new Error(
              `Cannot replace reserved service route: ${route.pattern}`
            );
          }
          existing.methods[normalizedMethod] = handler;
          existing.middleware = [
            ...new Set([...existing.middleware, ...asArray(route.middleware)]),
          ];
          existing.meta = { ...(existing.meta ?? {}), ...(route.meta ?? {}) };
          return;
        }

        routes.push({
          id: route.source ?? `inline:${route.pattern}:${normalizedMethod}`,
          absolutePath: route.source ?? route.pattern,
          relativePath: route.source ?? route.pattern,
          pattern: sanitizePathname(route.pattern),
          methods: { [normalizedMethod]: handler },
          middleware: asArray(route.middleware),
          meta: route.meta,
        });
      },
      /** Remove only an explicitly registered unreserved route or method.
       * @param {Parameters<ZeruxPluginApi['removeRoute']>[0]} pattern - Exact authored route pattern.
       * @param {Parameters<ZeruxPluginApi['removeRoute']>[1]} method - Optional method to remove; absence removes the whole route.
       * @returns {ReturnType<ZeruxPluginApi['removeRoute']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      removeRoute(pattern, method) {
        /** Shared canonical pattern used for protected route-removal checks. */
        const normalizedPattern = sanitizePathname(pattern);
        if (
          routesSealed &&
          serviceScope
            .httpRoutes()
            .some((item) =>
              serviceRouteOverlaps(item.pattern, normalizedPattern)
            )
        ) {
          throw new Error(`Cannot remove reserved service route: ${pattern}`);
        }
        /** Route index guarded against absence before mutation. */
        const index = routes.findIndex(
          (route) => route.pattern === normalizedPattern
        );
        if (index === -1) {
          return;
        }

        if (!method) {
          routes.splice(index, 1);
          return;
        }

        delete routes[index]!.methods[normalizeMethod(method)];
        if (Object.keys(routes[index]!.methods).length === 0) {
          routes.splice(index, 1);
        }
      },
      /** Register one trusted named middleware callback without executing it.
       * @param {Parameters<ZeruxPluginApi['addMiddleware']>[0]} name - Stable authored middleware identity.
       * @param {Parameters<ZeruxPluginApi['addMiddleware']>[1]} value - Trusted request middleware callback.
       * @returns {ReturnType<ZeruxPluginApi['addMiddleware']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      addMiddleware(name, value) {
        middleware.set(name, value);
      },
      /** Remove a named middleware registration; unresolved protection later fails closed at dispatch.
       * @param {Parameters<ZeruxPluginApi['removeMiddleware']>[0]} name - Exact authored middleware name.
       * @returns {ReturnType<ZeruxPluginApi['removeMiddleware']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      removeMiddleware(name) {
        middleware.delete(name);
      },
      /** Register trusted startup worker code without starting it during route registration.
       * @param {Parameters<ZeruxPluginApi['addWorker']>[0]} name - Stable worker identity.
       * @param {Parameters<ZeruxPluginApi['addWorker']>[1]} worker - Explicit trusted callback/descriptor.
       * @returns {ReturnType<ZeruxPluginApi['addWorker']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      addWorker(name, worker) {
        workers.set(name, normalizeWorker(name, worker));
      },
      /** Remove a registered startup worker descriptor.
       * @param {Parameters<ZeruxPluginApi['removeWorker']>[0]} name - Exact registered worker name.
       * @returns {ReturnType<ZeruxPluginApi['removeWorker']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      removeWorker(name) {
        workers.delete(name);
      },
      /** Read a registered startup descriptor without transferring its runtime lifecycle ownership.
       * @param {Parameters<ZeruxPluginApi['getWorker']>[0]} name - Exact registered worker name.
       * @returns {ReturnType<ZeruxPluginApi['getWorker']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      getWorker(name) {
        return workers.get(name);
      },
      /** Read fresh startup descriptor references for trusted runtime integration.
       * @returns {ReturnType<ZeruxPluginApi['getWorkers']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      getWorkers() {
        return [...workers.values()];
      },
      /** Capture an explicit trusted native script/pool descriptor; surrounding runtime worker activation owns startup.
       * @param {Parameters<ZeruxPluginApi['addThreadWorker']>[0]} name - Stable pool name.
       * @param {Parameters<ZeruxPluginApi['addThreadWorker']>[1]} worker - Trusted explicit script or pool settings.
       * @returns {ReturnType<ZeruxPluginApi['addThreadWorker']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      addThreadWorker(name, worker) {
        /** Explicit trusted thread worker descriptor with compatible defaults. */
        const normalizedWorker = normalizeThreadWorker(name, worker);
        threadWorkers.set(
          name,
          new ThreadWorkerPool({
            rootDir,
            mode,
            config,
            logger,
            serviceName: structure.serviceName,
            worker: normalizedWorker,
          })
        );
      },
      /** Remove a named pool registration; active pool shutdown remains with its worker lifecycle owner.
       * @param {Parameters<ZeruxPluginApi['removeThreadWorker']>[0]} name - Exact registered pool name.
       * @returns {ReturnType<ZeruxPluginApi['removeThreadWorker']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      removeThreadWorker(name) {
        threadWorkers.delete(name);
      },
      /** Read a registered native pool without transferring shutdown ownership.
       * @param {Parameters<ZeruxPluginApi['getThreadWorker']>[0]} name - Exact pool name.
       * @returns {ReturnType<ZeruxPluginApi['getThreadWorker']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      getThreadWorker(name) {
        return threadWorkers.get(name);
      },
      /** Read registered native pools while retaining lifecycle ownership with this generation.
       * @returns {ReturnType<ZeruxPluginApi['getThreadWorkers']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      getThreadWorkers() {
        return [...threadWorkers.values()];
      },
      /** Register a trusted generation-local composable value.
       * @param {Parameters<ZeruxPluginApi['setComposable']>[0]} name - Authored registry key.
       * @param {Parameters<ZeruxPluginApi['setComposable']>[1]} value - Trusted application value.
       * @returns {ReturnType<ZeruxPluginApi['setComposable']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      setComposable(name, value) {
        composables.set(name, value);
      },
      /** Register a trusted generation-local controller value.
       * @param {Parameters<ZeruxPluginApi['setController']>[0]} name - Authored registry key.
       * @param {Parameters<ZeruxPluginApi['setController']>[1]} value - Trusted application value.
       * @returns {ReturnType<ZeruxPluginApi['setController']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      setController(name, value) {
        controllers.set(name, value);
      },
      /** Read private host runtime configuration for trusted server plugins, never a public response projection.
       * @returns {ReturnType<ZeruxPluginApi['getConfig']>} Borrowed private server-only configuration/structure.
       */
      getConfig() {
        return config;
      },
      /** Read private resolved application discovery/build paths for trusted plugins.
       * @returns {ReturnType<ZeruxPluginApi['getStructure']>} Borrowed private server-only configuration/structure.
       */
      getStructure() {
        return structure;
      },
    };

    for (const pluginDir of structure.pluginDirs) {
      if (!fs.existsSync(pluginDir)) {
        continue;
      }

      /** Local metadata deciding explicit plugin file/directory discovery. */
      const stat = fs.statSync(pluginDir);
      /** Explicit configured plugin file/entry candidates, deduplicated before execution. */
      const pluginFiles = stat.isDirectory()
        ? [
            ...walkDirectory(pluginDir),
            ...fs
              .readdirSync(pluginDir)
              .map((name) => path.join(pluginDir, name))
              .filter(
                (candidate) =>
                  fs.existsSync(candidate) &&
                  fs.statSync(candidate).isDirectory()
              )
              .map((directory) => findScriptEntry(directory))
              .filter((candidate): candidate is string => Boolean(candidate)),
          ]
        : [pluginDir];

      for (const pluginFile of [...new Set(pluginFiles)]) {
        /** Trusted configured plugin namespace; no optional package scanning occurs. */
        const pluginModule = await importModule(pluginFile, mode);
        /** Explicit compatible plugin registration callback, required to be callable. */
        const registerPlugin = extractModuleValue<
          (api: ZeruxPluginApi) => Promise<void> | void
        >(pluginModule, ['default', 'register', 'plugin']);

        if (typeof registerPlugin === 'function') {
          await registerPlugin(pluginApi);
        }
      }
    }

    /** Trusted file routes discovered after plugin registration. */
    const discoveredRoutes = await discoverRoutes(
      rootDir,
      structure.appDir,
      mode,
      middleware,
      controllers
    );
    routes.push(...discoveredRoutes);

    /** Explicit resolved application entry path, absent when not authored. */
    const entryModulePath = findScriptEntry(rootDir, structure.entryPointName);
    if (entryModulePath) {
      /** Trusted application entry namespace from its configured file. */
      const entryModule = await importModule(entryModulePath, mode);
      /** Explicit compatible application registration callback. */
      const registerEntry = extractModuleValue<
        (api: ZeruxPluginApi) => Promise<void> | void
      >(entryModule, ['default', 'register', 'setup', 'boot']);

      if (typeof registerEntry === 'function') {
        await registerEntry(pluginApi);
      }
    }

    for (const route of routes.filter((route) =>
      route.id.startsWith('module:')
    )) {
      for (const method of Object.keys(route.methods)) {
        if (
          routes.some(
            (other) =>
              other !== route &&
              other.pattern === route.pattern &&
              other.methods[method]
          )
        ) {
          throw new Error('Module route collides with file/plugin route');
        }
      }
    }
    // Reserved Fetch endpoints belong to this generation, with collision protection.
    registerServiceHttpRoutes(pluginApi, serviceScope, [
      ...routes.map((route) => route.pattern),
      ...publicFiles.keys(),
    ]);
    routesSealed = true;

    // eslint-disable-next-line prefer-const -- Plugin callbacks capture the runtime before its deferred initialization.
    runtime = {
      rootDir,
      mode,
      config,
      structure,
      logger,
      middleware,
      controllers,
      composables,
      workers,
      workerState,
      threadWorkers,
      routes,
      publicFiles,
      entryModulePath,
      /** Read the borrowed generation gateway without implicitly constructing protocol resources.
       * @returns {ZeruxRuntime['protocolGateway']} Existing gateway, or undefined when no registration requested it.
       */
      get protocolGateway() {
        return appProtocols?.gateway;
      },
      /** Request closure of this generation’s explicitly created protocol gateway.
       * @returns {ReturnType<ZeruxRuntime['closeProtocols']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      closeProtocols() {
        appProtocols?.close();
      },
      serviceScope,
      variables: variableRegistry,
      /** Publish prepared compatibility handles and emit generation activation once.
       * @returns {ReturnType<ZeruxRuntime['activateServices']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      activateServices() {
        try {
          serviceScope.activate();
          if (!activated) {
            activated = true;
            notifyGeneration('generation:activate');
          }
        } catch (error) {
          notifyGeneration('generation:error');
          throw error;
        }
      },
      /** Dispose plugin/request/renderer/service ownership while preserving all cleanup failures and terminal observer notifications.
       * @returns {ReturnType<ZeruxRuntime['closeServices']>} Actual owned cleanup settlement; native workers have their separate surrounding shutdown owner.
       */
      closeServices() {
        if (!closePromise) {
          closePromise = Promise.resolve().then(async () => {
            runtimeClosed = true;
            notifyGeneration('generation:close');
            lifecycle.close();
            variableRegistry.clear();
            try {
              /** Private cleanup causes accumulated while all remaining owned releases run. */
              const errors: unknown[] = [];
              try {
                await disposePlugins();
              } catch (error) {
                errors.push(error);
              }
              try {
                await rendererRegistry.close();
              } catch (error) {
                errors.push(error);
              }
              try {
                await serviceScope.close();
              } catch (error) {
                errors.push(error);
              }
              if (errors.length) {
                throw new AggregateError(errors, 'Runtime cleanup failed');
              }
            } catch (error) {
              notifyGeneration('generation:error');
              throw error;
            } finally {
              try {
                await observer.close();
              } finally {
                notifyGeneration('generation:closed');
              }
            }
          });
        }
        return closePromise;
      },
      /** Project runtime/service readiness without external provider probes or private failure payloads.
       * @returns {ReturnType<ZeruxRuntime['getHealthStatus']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      getHealthStatus() {
        return {
          live: !runtimeClosed,
          ready:
            !runtimeClosed &&
            !serviceScope
              .status()
              .some(
                (item) => item.state === 'degraded' || item.state === 'closed'
              ),
        };
      },
      /** Read bounded fixed-label operational request observer counters.
       * @returns {ReturnType<ZeruxRuntime['getTelemetryStatus']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      getTelemetryStatus() {
        return observer.status();
      },
      /** Read bounded retained HTTP completion measurements, not a durable traffic history.
       * @param {Parameters<ZeruxRuntime['getLoadStatus']>[0]} windowMs - Optional supported measurement window in milliseconds.
       * @returns {ReturnType<ZeruxRuntime['getLoadStatus']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      getLoadStatus(windowMs) {
        return httpMetrics.snapshot(windowMs);
      },
      /** Create a native handler wrapping metrics, correlation and request lifecycle around the trusted runtime dispatcher.
       * @returns {ReturnType<ZeruxRuntime['createHandler']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      createHandler() {
        return observer.wrap(
          lifecycle.wrap(async (req: IncomingMessage, res: ServerResponse) => {
            httpMetrics.track(req, res);
            /** Native direct request Host value subject to explicit host admission, never a forwarded-header identity. */
            const host = req.headers.host || '';
            /** Host-configured request authority allowlist. */
            const allowedDomains =
              config.server?.allowedDomains ?? config.allowedDomains ?? [];
            /** Explicit development authority exception, independent of application authorization. */
            const allowedDevDomain =
              config.server?.allowedDevDomain ?? config.allowedDevDomain;
            setThemePreferenceHeaders(res, config);

            if (!isAllowedHost(host, allowedDomains, allowedDevDomain)) {
              /** Fixed safe host-denial diagnostic message. */
              const message = 'Request host is not allowed';
              if (mode === 'dev') {
                logger.error(message);
                await sendResponse(
                  res,
                  acceptsApiError(req.headers.accept)
                    ? normalizeApiError(new ApplicationError(400)).body
                    : { error: 'Unallowed Host', message },
                  400
                );
                return;
              } else {
                logger.error('Request host is not allowed');
                res.destroy();
                return;
              }
            }

            let context: ZeruxRequestContext | undefined;
            let declaredApi = false;
            try {
              /** Parsed authored registration or current request URL; origin trust is enforced separately. */
              const url = new URL(req.url || '/', 'http://127.0.0.1');
              /** Normalized native request path, independent of query parameters. */
              const pathname = sanitizePathname(url.pathname);
              if (
                appProtocols &&
                (await appProtocols.gateway.handle(req, res))
              ) {
                return;
              }
              /** Explicit discovered public-file mapping, if the path is public. */
              const staticFile = publicFiles.get(pathname);

              if (staticFile) {
                serveStaticFile(res, staticFile);
                return;
              }

              /** Normalized authored/native HTTP method used only to select registered handlers. */
              const method = normalizeMethod(req.method);
              /** Native incoming media type; route-specific adapters still enforce their own validation. */
              const contentType = req.headers['content-type'] || '';
              let body: unknown = undefined;
              /** Pre-body shared route match selecting explicit API/streamBody policy. */
              const earlyRoute = matchRoute(
                sortRoutes(routes),
                pathname,
                method
              );
              declaredApi = earlyRoute?.route.meta?.api === true;
              /** Whether this path belongs to an already protected service registration. */
              const internalServiceRequest =
                earlyRoute?.route.id.startsWith('service:') === true;
              /** Explicit stream ownership opt-in; buffered compatibility reading is bypassed only under its route policy. */
              const streamBody =
                earlyRoute?.route.meta?.streamBody === true &&
                (!multisiteEnabled || internalServiceRequest);
              if (
                req.method &&
                !['GET', 'HEAD'].includes(req.method.toUpperCase()) &&
                !streamBody
              ) {
                /** Bounded legacy buffered request bytes before JSON/text parsing. */
                const rawBody = await readRequestBody(req);
                if (rawBody.length > 0) {
                  if (contentType.includes('application/json')) {
                    try {
                      body = JSON.parse(rawBody.toString('utf-8'));
                    } catch (error) {
                      throw new ApplicationError(400, error);
                    }
                  } else {
                    body = rawBody.toString('utf-8');
                  }
                }
              }

              /** Request-local explicit app-folder registrations; never shared across requests. */
              const multisiteRegistrations: MultisiteRegistration[] = [];
              let multisiteRegistrationMissed = false;
              /** Apply only this request’s authored multisite registrations while preserving reserved internal service routing.
               * @returns {void} Request-local path/state update or unchanged path.
               */
              const applyRegisteredMultisite = () => {
                if (
                  !multisiteEnabled ||
                  internalServiceRequest ||
                  multisiteRegistrations.length === 0
                ) {
                  return;
                }

                /** Actual middleware/handler or explicit multisite selection result, consumed under the current stage’s owner. */
                const result = applyMultisitePath(
                  host,
                  pathname,
                  multisiteRegistrations
                );
                multisiteRegistrationMissed = !result;
                if (
                  !result ||
                  !context ||
                  result.pathname === context.pathname
                ) {
                  return;
                }

                context.state.multisite = {
                  enabled: true,
                  originalPathname: pathname,
                  pathname: result.pathname,
                  url: result.registration.url,
                  folderName: result.registration.folderName,
                };
                context.pathname = result.pathname;
                context.url.pathname = result.pathname;
              };

              context = {
                requestLifecycle: getServerRequestLifecycle(req)?.context,
                render: (registration, view, feature) => {
                  /** Borrowed request lifecycle projection required before renderer dispatch. */
                  const request = getServerRequestLifecycle(req)?.context;
                  if (!request) {
                    throw new Error('Renderer request lifecycle unavailable');
                  }
                  return rendererRegistry.render(
                    registration,
                    view,
                    {
                      requestId: request.requestId,
                      pathname: context!.pathname,
                      signal: request.signal,
                    },
                    feature
                  );
                },
                req,
                res,
                method,
                url,
                pathname,
                params: {},
                query: url.searchParams,
                body: streamBody ? req : body,
                requestStream: req,
                /** Apply explicit validated response cache policy before native commitment.
                 * @param {Parameters<ZeruxRequestContext['setCache']>[0]} policy - Host-selected HTTP cache policy; authenticated data remains private by default.
                 * @returns {ReturnType<ZeruxRequestContext['setCache']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
                 */
                setCache(policy) {
                  applyCachePolicy(res, policy);
                },
                stream,
                /** Register explicit host/path-to-app mapping only for this request when multisite is enabled.
                 * @param {Parameters<ZeruxRequestContext['multisiteRegister']>[0]} registerUrl - Trusted authored registration URL/host.
                 * @param {Parameters<ZeruxRequestContext['multisiteRegister']>[1]} folderName - Validated single app-folder segment.
                 * @returns {ReturnType<ZeruxRequestContext['multisiteRegister']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
                 */
                multisiteRegister(registerUrl: string, folderName: string) {
                  if (!multisiteEnabled) {
                    return;
                  }
                  multisiteRegistrations.push(
                    createMultisiteRegistration(
                      registerUrl,
                      folderName,
                      multisiteRegistrations.length
                    )
                  );
                },
                logger,
                config,
                runtime,
                state: { zeruxApiError: declaredApi },
                env: process.env,
                services: {
                  get: (name) => serviceScope.get(name),
                  controllers: Object.fromEntries(controllers.entries()),
                  composables: Object.fromEntries(composables.entries()),
                },
              };

              /** Deduplicated trusted global callbacks in discovery order. */
              const globalMiddlewareStack = [...new Set(globalMiddleware)]
                .map((name) => middleware.get(name))
                .filter((fn): fn is MiddlewareFunction => Boolean(fn));

              let globalIndex = -1;
              let passedGlobalMiddleware = false;
              /** Enforce one forward continuation per global middleware before route dispatch.
               * @param {number} cursor - Next trusted global middleware index.
               * @returns {Promise<void>} Actual middleware/response settlement.
               */
              const dispatchGlobal = async (cursor: number): Promise<void> => {
                applyRegisteredMultisite();

                if (cursor <= globalIndex) {
                  throw new Error('next() called multiple times');
                }

                globalIndex = cursor;
                /** Next trusted middleware callback, absent at the terminal dispatch stage. */
                const current = globalMiddlewareStack[cursor];
                if (current) {
                  /** Actual middleware/handler or explicit multisite selection result, consumed under the current stage’s owner. */
                  const result = await current(context!, () =>
                    dispatchGlobal(cursor + 1)
                  );
                  if (!res.writableEnded && result !== undefined) {
                    await sendResponse(res, result, 200, context);
                  }
                  return;
                }
                passedGlobalMiddleware = true;
              };

              await dispatchGlobal(0);
              if (!passedGlobalMiddleware) {
                if (!res.headersSent && !res.writableEnded) {
                  await sendResponse(res, { error: 'Forbidden' }, 403, context);
                }
                return;
              }
              applyRegisteredMultisite();

              if (res.writableEnded) {
                return;
              }

              /** Current explicit route or multisite match; no caller-supplied handler is executed. */
              const match = matchRoute(
                sortRoutes(routes),
                context.pathname,
                method
              );
              getServerRequestLifecycle(req)?.route(
                match?.route.pattern ?? null
              );

              if (!match) {
                await sendResponse(
                  res,
                  {
                    message: 'Route not found',
                  },
                  404,
                  context
                );
                return;
              }

              if (
                multisiteRegistrationMissed &&
                isRootDynamicRoute(match.route)
              ) {
                await sendResponse(
                  res,
                  {
                    message: 'Route not found',
                  },
                  404,
                  context
                );
                return;
              }

              if (!match.handler) {
                await sendResponse(
                  res,
                  {
                    message: 'Method not allowed',
                  },
                  405,
                  context
                );
                return;
              }

              context.params = match.params;

              /** Explicit unresolved route middleware references; missing protection fails closed. */
              const missingMiddleware = match.route.middleware.filter(
                (name) =>
                  !globalMiddleware.includes(name) && !middleware.has(name)
              );
              if (missingMiddleware.length) {
                logger.error('Route references unregistered middleware', {
                  path: match.route.pattern,
                });
                await sendResponse(
                  res,
                  { error: 'Route middleware unavailable' },
                  500,
                  context
                );
                return;
              }
              /** Explicit registered non-global route middleware in authored order. */
              const routeMiddlewareStack = [...new Set(match.route.middleware)]
                .filter((name) => !globalMiddleware.includes(name))
                .map((name) => middleware.get(name))
                .filter((fn): fn is MiddlewareFunction => Boolean(fn));

              let routeIndex = -1;
              /** Execute the route middleware chain once per continuation, then send the trusted registered handler result.
               * @param {number} cursor - Next explicit route middleware index.
               * @returns {Promise<void>} Actual middleware/handler/response settlement.
               */
              const dispatchRoute = async (cursor: number): Promise<void> => {
                if (cursor <= routeIndex) {
                  throw new Error('next() called multiple times');
                }

                routeIndex = cursor;
                /** Next trusted middleware callback, absent at the terminal dispatch stage. */
                const current = routeMiddlewareStack[cursor];
                if (current) {
                  /** Actual middleware/handler or explicit multisite selection result, consumed under the current stage’s owner. */
                  const result = await current(context!, () =>
                    dispatchRoute(cursor + 1)
                  );
                  if (!res.writableEnded && result !== undefined) {
                    await sendResponse(res, result, 200, context);
                  }
                  return;
                }

                /** Actual middleware/handler or explicit multisite selection result, consumed under the current stage’s owner. */
                const result = await match.handler!(context!);
                if (!res.writableEnded) {
                  await sendResponse(res, result, 200, context);
                }
              };

              await dispatchRoute(0);
            } catch (error) {
              getServerRequestLifecycle(req)?.error('handler');
              observer.report(error);
              /** Whether negotiated or declared API policy requires safe structured error projection. */
              const apiError =
                acceptsApiError(req.headers.accept) || declaredApi;
              /** Negotiated safe API or legacy HTML error projection; never the private raw cause. */
              let normalized: { status: number; body: unknown };
              if (apiError) {
                normalized = normalizeApiError(error);
              } else if (
                error &&
                typeof error === 'object' &&
                'statusCode' in error &&
                error.statusCode === 413
              ) {
                normalized = {
                  status: 413,
                  body: { error: 'Payload Too Large' },
                };
              } else {
                normalized = exceptionHandler(error);
              }
              if (res.headersSent) {
                if (!res.writableEnded) {
                  res.destroy();
                }
              } else if (!res.writableEnded) {
                if (apiError) {
                  res.setHeader('cache-control', 'no-store');
                  res.setHeader('vary', 'Accept');
                }
                await sendResponse(
                  res,
                  normalized.body,
                  normalized.status,
                  context
                );
              }
            }
          })
        );
      },
      /** Read this generation’s trusted plugin registration/lookup authority.
       * @returns {ReturnType<ZeruxRuntime['asPluginApi']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      asPluginApi() {
        return pluginApi;
      },
      /** Project private runtime orientation and public-only config without serializing executable handlers or credentials.
       * @returns {ReturnType<ZeruxRuntime['toManifest']>} Explicit generation/request contract result; no broader ownership or authorization is inferred.
       */
      toManifest() {
        return {
          generatedAt: new Date().toISOString(),
          mode,
          rootDir,
          entryModulePath,
          config: serviceScope.publicConfig(),
          services: serviceScope.status(),
          structure: {
            ...structure,
            rootDir: undefined,
            raw: structure.raw,
          },
          middleware: [...middleware.keys()].sort(),
          globalMiddleware,
          controllers: [...controllers.keys()].sort(),
          composables: [...composables.keys()].sort(),
          workers: [...workers.values()].map((worker) => ({
            name: worker.name,
          })),
          threadWorkers: [...threadWorkers.values()].map((worker) => ({
            name: worker.name,
            size: worker.size,
            minThreads: worker.minThreads,
            maxThreads: worker.maxThreads,
          })),
          routes: routes.map((route) => ({
            id: route.id,
            path: route.pattern,
            file: route.relativePath,
            methods: Object.keys(route.methods).sort(),
            middleware: route.middleware,
          })),
          publicFiles: [...publicFiles.keys()].sort(),
        };
      },
    };

    return runtime;
  } catch (error) {
    lifecycle.close();
    variableRegistry.clear();
    appProtocols?.close();
    /** Private cleanup causes accumulated while all remaining owned releases run. */
    const errors: unknown[] = [error];
    try {
      await disposePlugins();
    } catch (cleanup) {
      errors.push(cleanup);
    }
    try {
      await rendererRegistry.close();
    } catch (cleanup) {
      errors.push(cleanup);
    }
    await observer.close();
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Runtime preparation cleanup failed');
    }
    throw error;
  }
};

/** Validate before acquisition, prepare services/runtime and notify metadata-only generation phases with reverse failure cleanup.
 * @param {string} rootDir - Trusted project root.
 * @param {RuntimeMode} mode - Explicit development/start mode.
 * @param {ZeruxConfig} config - Private host configuration consumed for this generation.
 * @param {ResolvedStructure} structure - Explicit resolved local discovery paths.
 * @param {Partial<ServiceInitializers>} providers - Optional explicit host initializer overrides.
 * @param {object} options - Optional delayed compatibility activation policy.
 * @param {boolean} options.deferActivation - Publish prepared compatibility handles only after explicit activation.
 * @returns {Promise<BootstrapResult>} Prepared runtime receipt; no HTTP listener is started here.
 */
export const bootstrapApplication = async (
  rootDir: string,
  mode: RuntimeMode,
  config: ZeruxConfig,
  structure: ResolvedStructure,
  providers: Partial<ServiceInitializers> = {},
  options: { deferActivation?: boolean } = {}
): Promise<BootstrapResult> => {
  validateCoreConfig(config);
  /** Borrowed host lifecycle bus used only for fixed generation phases. */
  const hooks = config.lifecycleHooks;
  /** Opaque generation correlation identity; never derived from a user or request. */
  const generationId =
    config.observability?.generationId ?? randomBytes(12).toString('hex');
  config.observability = { ...config.observability, generationId };
  /** Already emitted generation phases preventing duplicate lifecycle notifications. */
  const phases = new Set<string>();
  /** Emit each fixed generation lifecycle phase once while isolating observer failure.
   * @param {string} phase - Fixed server lifecycle generation phase.
   * @returns {void} Metadata-only notification completion.
   */
  const notify = (
    phase: Extract<keyof ServerLifecycleEvents, `generation:${string}`>
  ) => {
    if (phases.has(phase)) {
      return;
    }
    phases.add(phase);
    try {
      hooks?.dispatch(phase, Object.freeze({ generationId }));
    } catch {
      logger.error('Generation lifecycle observer failed');
    }
  };
  notify('generation:prepare');
  let serviceScope: RuntimeServiceScope | undefined;
  try {
    serviceScope = await initializeRuntimeServices(
      config,
      rootDir,
      providers,
      options
    );
    /** Prepared generation runtime returned only after service/registration setup succeeds. */
    const runtime = await createRuntime(
      rootDir,
      mode,
      config,
      structure,
      serviceScope,
      notify
    );
    notify('generation:ready');
    if (!options.deferActivation) {
      runtime.activateServices();
    }
    return { config, structure, runtime, manifestPath: '' };
  } catch (error) {
    notify('generation:error');
    notify('generation:close');
    try {
      await serviceScope?.close();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        'Application preparation and rollback failed'
      );
    } finally {
      notify('generation:closed');
    }
    throw error;
  }
};
