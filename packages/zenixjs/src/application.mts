import { randomBytes, randomUUID } from 'node:crypto';
import type { Cms, CmsScope } from '@zenixjs/core/cms';
import { CmsError } from '@zenixjs/core/cms';
import {
  createRendererRegistry,
  createZyroRenderer,
  isRenderedHtml,
} from 'zeruxjs/renderers';
import { registerFetchRoutes } from 'zeruxjs/fetch-route';
import type { ZeruxPluginApi } from 'zeruxjs';
import { h, type VNodeChild } from 'zyrojs/component';
import { renderToString } from 'zyrojs/dom';
import { createSecurityPolicy } from '@zeruxjs/security/policy';
import {
  createHttpInputAdapter,
  HttpValidationError,
} from '@zeruxjs/validator/http';
import { strictObject, string } from '@zeruxjs/validator/schemas';
import type { LabelledComponentProps } from '@zeruxjs/accessibility';
import type { BrandVersion } from '@zeruxjs/asset-manager/brand';
import {
  setupScope,
  type SetupStore,
  type SetupRecord,
} from './setup-store.mjs';
/** Host-verified private proof plus nonsecret session binding; never a browser role claim. */
export interface ZenixSession {
  /** Private server session/proof supplied to core resolvePrincipal. */ principal: unknown;
  /** Opaque nonsecret binding, never a browser role or raw cookie. */ key: string;
}
/** Explicit private host integration; configuring callbacks does not itself authenticate a request. */
export interface ZenixOptions {
  /** Borrowed tenant-authorized core; application close never destroys it. */
  cms: Cms;
  /** Fixed host-owned tenant/site identifiers, never selected by request input. */
  scope: CmsScope;
  /** Borrowed durable CAS journal; host qualifies its storage lifetime. */
  setupStore: SetupStore;
  /** Exact configured public origin; arbitrary forwarded headers cannot replace it. */
  origin: string;
  /** Canonical fixed root/subpath mount for explicit routes. */
  basePath: string;
  /** Fixed supported entry identity for this editor/theme. */
  entryId: string;
  /** Fixed host-owned read-only core identity; never derived from public request data. */
  publicPrincipal: unknown;
  /** Verify the initiating session with the host's persistent identity system.
   * @param {Request} request - Current request; headers alone are never proof.
   * @returns {Promise<ZenixSession | null>} Verified private proof and opaque binding, or no session.
   */
  authenticate(request: Request): Promise<ZenixSession | null>;
  /** Verify private credentials through host policy; no default administrator exists.
   * @param {{username: string, password: string}} input - Bounded validated private form values.
   * @param {string} input.username - Host account identifier, never an authorization role.
   * @param {string} input.password - Private credential, never echoed in responses/logs.
   * @param {Request} request - Current admitted Origin/CSRF-checked login request.
   * @returns {Promise<{cookie: string} | null>} Reviewed host session cookie or denied login.
   */
  login(
    input: { username: string; password: string },
    request: Request
  ): Promise<{ cookie: string } | null>;
  /** Terminate a host session after application Origin/CSRF checks.
   * @param {ZenixSession} session - Fresh verified initiating proof.
   * @param {Request} request - Current admitted logout request.
   * @returns {Promise<{cookie: string}>} Reviewed expiry cookie; host owns actual session revocation.
   */
  logout(session: ZenixSession, request: Request): Promise<{ cookie: string }>;
  /** Reauthorize one privileged action independently of schema/input validation.
   * @param {'setup' | 'dashboard' | 'edit' | 'preview' | 'publish'} action - Fixed reviewed action.
   * @param {ZenixSession} session - Verified initiating proof; core checks it again.
   * @param {Request} request - Optional current request; trusted recovery has no HTTP route.
   * @returns {Promise<boolean>} Only explicit true permits the operation.
   */
  authorize(
    action: 'setup' | 'dashboard' | 'edit' | 'preview' | 'publish',
    session: ZenixSession,
    request?: Request
  ): Promise<boolean>;
  /** Host-owned issue/verify policies bound to the real request and session. */
  csrf: {
    issue(
      request: Request,
      session: ZenixSession | null
    ): Promise<{ token: string; cookie?: string }>;
    verify(
      request: Request,
      session: ZenixSession | null,
      token: string
    ): Promise<boolean>;
  };
  /** Constant-time host secret check plus fresh setup privilege. No bundled administrator/password. */
  verifySetupSecret(
    secret: string,
    session: ZenixSession,
    request: Request
  ): Promise<boolean>;
  /** Trusted operator-only procedure; never mounted as an HTTP route. */
  authorizeRecovery(
    evidence: unknown,
    session: ZenixSession,
    claim: string
  ): Promise<boolean>;
  /** Host rate/admission policy for login and setup; no loopback exemption. */
  admit(request: Request, action: 'login' | 'setup'): Promise<boolean>;
  /** Optional inert theme name and immutable brand reference; no code or HTML is loaded. */
  theme?: {
    name: string;
    brand?: Pick<BrandVersion, 'versionId' | 'assetId' | 'hash'>;
  };
}
/** Fixed immutable article schema facts; no saved content can register executable field types. */
const articleSchema = {
  id: 'article',
  version: 1,
  fields: {
    title: { kind: 'text' as const, required: true, maxLength: 200 },
    body: { kind: 'text' as const, required: true, maxLength: 8192 },
  },
};
/** Internal fixed-code rejection; HTTP responses never serialize its cause or request values. */
class ResponseError extends Error {
  /** Associate a fixed HTTP status with a redacted internal failure.
   * @param {number} status - Authored bounded HTTP status selected by application logic.
   */
  constructor(readonly status: number) {
    super('Zenix request rejected');
  }
}
/** Validate fixed tenant/site/entry identifiers without deriving identity from a request.
 * @param {unknown} v - Inert candidate identifier.
 * @returns {boolean} Whether it is a supported bounded literal name.
 */
const allowedName = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(v);
/** Declare an authored control label without synthesizing text from content.
 * @param {string} text - Trusted authored UI label.
 * @returns {LabelledComponentProps} Explicit accessibility contract.
 */
const label = (text: string): LabelledComponentProps => ({ label: text });
/** Render a native labelled required input with inert value text.
 * @param {string} name - Fixed authored field identifier.
 * @param {string} text - Authored visible label.
 * @param {string} type - Fixed native input type.
 * @param {string} value - Inert displayed value escaped by ZyroJS.
 * @returns {VNodeChild} Native labelled input tree.
 */
const field = (name: string, text: string, type = 'text', value = '') => {
  /** Fixed authored input policy; never inferred from arbitrary content. */
  let autocomplete: string;
  if (name === 'secret') {
    autocomplete = 'off';
  } else if (type === 'password') {
    autocomplete = 'current-password';
  } else if (name === 'username') {
    autocomplete = 'username';
  } else {
    autocomplete = 'off';
  }

  return h(
    'div',
    null,
    h('label', { for: name }, text),
    h('input', {
      id: name,
      name,
      type,
      value,
      required: true,
      'aria-label': label(text).label,
      autocomplete,
    })
  );
};
/** Render one inert hidden form value through native DOM serialization.
 * @param {string} name - Fixed authored field name.
 * @param {string} value - Inert scalar form value.
 * @returns {VNodeChild} Hidden input node.
 */
const hidden = (name: string, value: string) =>
  h('input', { type: 'hidden', name, value });
/** Render an ordinary POST form with explicit host-issued CSRF token.
 * @param {string} action - Fixed application-local route.
 * @param {string} csrf - Private host-issued form token.
 * @param {VNodeChild[]} children - Trusted authored control nodes.
 * @returns {VNodeChild} Native no-JavaScript form tree.
 */
const form = (action: string, csrf: string, children: VNodeChild[]) =>
  h('form', { method: 'post', action }, hidden('csrf', csrf), ...children);
/** Render an authored native submit control without positive tab order.
 * @param {string} text - Trusted button label.
 * @returns {VNodeChild} Native submit button.
 */
const button = (text: string) => h('button', { type: 'submit' }, text);
/** Append only a bounded reviewed host cookie without accepting header injection.
 * @param {Headers} headers - Fresh response-owned header collection.
 * @param {string | undefined} value - Optional private cookie returned by a trusted host callback.
 * @returns {void} Appends the reviewed value or throws a fixed internal rejection.
 */
function cookie(headers: Headers, value: string | undefined) {
  if (value !== undefined) {
    if (
      typeof value !== 'string' ||
      !value ||
      value.length > 8192 ||
      /[\r\n]/.test(value)
    ) {
      throw new ResponseError(500);
    }
    headers.append('set-cookie', value);
  }
}
/** Opt-in SSR application. All CMS/auth/stores are borrowed and explicitly configured.
 * @param {ZenixOptions} options - Fixed private host scope, durable setup and verified authorization contracts.
 * @returns {object} Owned explicit handle/install/recovery/close API; host must close it before borrowed stores.
 */
export function createZenixApplication(options: ZenixOptions) {
  if (
    !options ||
    !allowedName(options.scope?.tenant) ||
    !allowedName(options.scope?.site) ||
    !allowedName(options.entryId) ||
    !/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(options.basePath) ||
    (options.basePath.endsWith('/') && options.basePath !== '/')
  ) {
    throw new TypeError('Invalid fixed Zenix scope/path');
  }
  if (
    Object.keys(options).some(
      (k) =>
        ![
          'cms',
          'scope',
          'setupStore',
          'origin',
          'basePath',
          'entryId',
          'publicPrincipal',
          'authenticate',
          'login',
          'logout',
          'authorize',
          'csrf',
          'verifySetupSecret',
          'authorizeRecovery',
          'admit',
          'theme',
        ].includes(k)
    )
  ) {
    throw new TypeError('Unknown Zenix configuration');
  }
  /** Exact configured public origin; request Host/forwarded headers never select it. */
  const origin = new URL(options.origin);
  if (
    origin.origin !== options.origin ||
    !['http:', 'https:'].includes(origin.protocol)
  ) {
    throw new TypeError('Exact public origin required');
  }
  if (
    options.setupStore?.contract !== 'zenix-setup-cas-v1' ||
    options.setupStore.durability !== 'durable' ||
    ['read', 'claim', 'complete'].some(
      (k) => typeof (options.setupStore as any)[k] !== 'function'
    ) ||
    [
      'authenticate',
      'login',
      'logout',
      'authorize',
      'verifySetupSecret',
      'authorizeRecovery',
      'admit',
    ].some((k) => typeof (options as any)[k] !== 'function') ||
    typeof options.csrf?.issue !== 'function' ||
    typeof options.csrf.verify !== 'function' ||
    !options.cms ||
    [
      'createSite',
      'readSite',
      'registerContentType',
      'readContentType',
      'saveDraft',
      'readEntry',
      'readRevision',
      'publish',
      'readPublished',
    ].some((k) => typeof (options.cms as any)[k] !== 'function') ||
    options.publicPrincipal === undefined
  ) {
    throw new TypeError('Explicit CMS and host security contracts required');
  }
  /** Private fixed tenant/site snapshot; requests cannot choose another scope. */
  const scope = { ...options.scope };
  /** Canonical application mount prefix; root mount uses an empty join prefix. */
  const base = options.basePath === '/' ? '' : options.basePath;
  /** Join only fixed authored route suffixes under the configured mount.
   * @param {string} suffix - Internal reviewed route suffix.
   * @returns {string} Mounted local route path.
   */
  const path = (suffix: string) => base + suffix;
  /** Tenant/site-bound setup journal reference; hashing is not authorization or anonymization. */
  const setupId = setupScope(scope.tenant, scope.site);
  /** Fixed host-configured entry; no public request can select a different entry. */
  const entryId = options.entryId;
  /** Cloned inert theme/brand reference facts; notes, logos and executable theme code are not loaded. */
  const theme = structuredClone(options.theme ?? { name: 'Zenix' });
  if (
    typeof theme.name !== 'string' ||
    theme.name.length > 100 ||
    (theme.brand &&
      (!/^[a-f0-9]{48}$/.test(theme.brand.versionId) ||
        typeof theme.brand.assetId !== 'string' ||
        theme.brand.assetId.length > 128 ||
        (theme.brand.hash !== null &&
          !/^[a-f0-9]{64}$/.test(theme.brand.hash))))
  ) {
    throw new TypeError('Invalid pinned theme brand reference');
  }
  /** Production response policy; request headers cannot weaken its CSP. */
  const policy = createSecurityPolicy({
    mode: 'production',
    https: origin.protocol === 'https:',
  });
  /** Owned bounded renderer registry, drained during application close. */
  const registry = createRendererRegistry({
    maxBytes: 131072,
    maxActive: 8,
    timeoutMs: 5000,
  });
  /** Explicit standalone static HTML renderer token in this application's registry. */
  const renderer = registry.register(
    createZyroRenderer<VNodeChild>(renderToString)
  );
  /** Owned bounded form-reader adapter; duplicate/unknown fields and uploaded files reject. */
  const input = createHttpInputAdapter({
    maxBytes: 20000,
    maxFields: 6,
    maxFieldBytes: 10000,
    duplicates: 'reject',
    files: 'reject',
    bodyTimeoutMs: 3000,
    maxConcurrentReads: 8,
  });
  /** Private bounded process-local session/revision capabilities; never public bearer links. */
  const preview = new Map<
    string,
    { session: string; revision: number; expiresAt: number }
  >();
  /** Owned cooperative application lifetime; abort does not prove mutation rollback. */
  const controller = new AbortController();
  /** Actual admitted handler promises; capacity is retained until settlement. */
  const pending = new Set<Promise<unknown>>();
  let closed = false,
    closing: Promise<void> | undefined;
  /** Bound admission and retain slots through actual work settlement.
   * @param {() => Promise<T>} fn - Trusted application operation.
   * @returns {Promise<T>} Actual operation settlement or fixed admission failure.
   */
  const run = <T,>(fn: () => Promise<T>): Promise<T> => {
    if (closed) {
      return Promise.reject(new ResponseError(503));
    }
    if (pending.size >= 8) {
      return Promise.reject(new ResponseError(503));
    }
    /** Actual handler settlement tracked until its finally callback releases capacity. */
    const work = Promise.resolve()
      .then(fn)
      .finally(() => pending.delete(work));
    pending.add(work);
    return work;
  };
  /** Create private no-store headers with explicit crawler policy.
   * @param {boolean} privatePage - Whether to add noindex/nofollow/noarchive.
   * @returns {Headers} Fresh response-owned header collection.
   */
  const headers = (privatePage = true) => {
    /** Bounded renderer/auth/operation result; private failures are never echoed. */
    const result = new Headers(policy.createResponse().headers);
    result.set('cache-control', 'private, no-store');
    result.set('referrer-policy', 'no-referrer');
    if (privatePage) {
      result.set('x-robots-tag', 'noindex, nofollow, noarchive');
    }
    return result;
  };
  /** Create a fixed application redirect with an optional host-reviewed cookie.
   * @param {string} to - Authored mounted path, not request-supplied redirect input.
   * @param {string} extraCookie - Optional private host session cookie.
   * @returns {Response} Empty 303 response with private cache/security policy.
   */
  const redirect = (to: string, extraCookie?: string) => {
    /** Fresh response-owned headers carrying only reviewed policy/cookies. */
    const hd = headers();
    hd.set('location', to);
    cookie(hd, extraCookie);
    return new Response(null, { status: 303, headers: hd });
  };
  /** Render a trusted native document within the owned registry limits.
   * @param {Request} request - Admitted request with cooperative cancellation.
   * @param {string} title - Inert document title escaped by the renderer.
   * @param {VNodeChild} body - Trusted authored content tree; text values remain inert.
   * @param {Headers} hd - Fresh response policy headers.
   * @returns {Promise<Response>} Complete HTML response after render validation.
   */
  const html = async (
    request: Request,
    title: string,
    body: VNodeChild,
    hd = headers()
  ) => {
    controller.signal.throwIfAborted();
    /** Authored document tree; private session and form state are not serialized as hydration data. */
    const doc = h(
      'html',
      { lang: 'en' },
      h(
        'head',
        null,
        h('meta', { charset: 'utf-8' }),
        h('meta', {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1',
        }),
        h('title', null, title)
      ),
      h(
        'body',
        null,
        h('a', { href: '#main' }, 'Skip to content'),
        h('main', { id: 'main', tabindex: '-1' }, h('h1', null, title), body)
      )
    );
    /** Bounded renderer/auth/operation result; private failures are never echoed. */
    const result = await registry.render(renderer, doc, {
      requestId: randomUUID(),
      pathname: new URL(request.url).pathname,
      signal: request.signal,
    });
    if (!isRenderedHtml(result)) {
      throw new ResponseError(500);
    }
    hd.set('content-type', 'text/html; charset=utf-8');
    return new Response('<!doctype html>' + result.html, { headers: hd });
  };
  /** Ask the host for a verified session and validate its opaque nonsecret binding.
   * @param {Request} request - Current request; host owns session verification and dependency deadlines.
   * @returns {Promise<ZenixSession | null>} Borrowed verified proof or no session.
   */
  const session = async (request: Request) => {
    /** Host-verified borrowed session proof; core authorization rechecks its principal. */
    const s = await options.authenticate(request);
    if (
      s &&
      (typeof s.key !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(s.key))
    ) {
      throw new ResponseError(403);
    }
    return s;
  };
  /** Reauthorize the current action before private work and recheck cancellation.
   * @param {Parameters<ZenixOptions["authorize"]>[0]} action - Fixed reviewed application action.
   * @param {ZenixSession} s - Host-verified borrowed initiating proof.
   * @param {Request} request - Optional current request for host authorization.
   * @returns {Promise<void>} Returns only after explicit true authorization.
   */
  const permit = async (
    action: Parameters<ZenixOptions['authorize']>[0],
    s: ZenixSession,
    request?: Request
  ) => {
    if ((await options.authorize(action, s, request)) !== true) {
      throw new ResponseError(403);
    }
    controller.signal.throwIfAborted();
    request?.signal.throwIfAborted();
  };
  /** Issue a host-owned form token and optional reviewed cookie.
   * @param {Request} req - Current request including session transport.
   * @param {ZenixSession | null} s - Verified session or explicit anonymous login context.
   * @returns {Promise<{token: string, headers: Headers}>} Validated token and private response headers.
   */
  const csrf = async (req: Request, s: ZenixSession | null) => {
    /** Host-issued CSRF token/cookie; validates bounds before rendering or appending. */
    const issued = await options.csrf.issue(req, s);
    if (
      typeof issued.token !== 'string' ||
      !issued.token ||
      issued.token.length > 256
    ) {
      throw new ResponseError(500);
    }
    /** Fresh response-owned headers carrying only reviewed policy/cookies. */
    const hd = headers();
    cookie(hd, issued.cookie);
    return { token: issued.token, headers: hd };
  };
  /** Parse exactly the authored required strings through the bounded HTTP/schema owner.
   * @param {Request} req - Current admitted request with cooperative cancellation.
   * @param {readonly string[]} fields - Fixed authored required field names, never client-selected schema input.
   * @returns {Promise<Record<string, string>>} Validated private strings; unknown/duplicate/file inputs reject.
   */
  async function parse(req: Request, fields: readonly string[]) {
    if (
      req.headers.get('content-type')?.split(';')[0]!.trim() !==
      'application/x-www-form-urlencoded'
    ) {
      throw new ResponseError(415);
    }
    /** Strict required string schema for the exact authored form fields. */
    const schema = strictObject(
      Object.fromEntries(fields.map((k) => [k, string()]))
    );
    return (await input.parseFormRequest(schema, req)) as Record<
      string,
      string
    >;
  }
  /** Require the host to verify a bounded CSRF token bound to the actual request/session.
   * @param {Request} req - Current admitted request whose Origin was already checked.
   * @param {ZenixSession | null} s - Verified session or anonymous login form context.
   * @param {Record<string, string>} data - Strictly validated private form fields.
   * @returns {Promise<void>} Returns only after explicit true verification and cancellation check.
   */
  async function verify(
    req: Request,
    s: ZenixSession | null,
    data: Record<string, string>
  ) {
    if (
      !data.csrf ||
      data.csrf.length > 256 ||
      (await options.csrf.verify(req, s, data.csrf)) !== true
    ) {
      throw new ResponseError(403);
    }
    req.signal.throwIfAborted();
  }
  /** Reconcile only the fixed site/schema before conditionally completing a durable setup claim.
   * @param {SetupRecord} record - Original durable scope/claim binding; never a setup secret.
   * @param {ZenixSession} s - Fresh host-authorized operator proof rechecked by core operations.
   * @param {AbortSignal} signal - Borrowed request/application lifetime; cancellation never proves rollback.
   * @returns {Promise<void>} Completes the claim after core persistence; these stores are not globally atomic.
   */
  async function provision(
    record: SetupRecord,
    s: ZenixSession,
    signal: AbortSignal = controller.signal
  ) {
    signal.throwIfAborted();
    /** Core-authorized persisted site/entry state; drafts never substitute for published content. */
    const current = await options.cms.readSite(scope, s.principal);
    if (current && current.name !== theme.name) {
      throw new ResponseError(409);
    }
    signal.throwIfAborted();
    if (!current) {
      await options.cms.createSite(scope, theme.name, s.principal);
    }
    signal.throwIfAborted();
    /** Persisted article schema facts compared with the fixed supported definition. */
    const type = await options.cms.readContentType(
      scope,
      'article',
      1,
      s.principal
    );
    if (type && JSON.stringify(type) !== JSON.stringify(articleSchema)) {
      throw new ResponseError(409);
    }
    signal.throwIfAborted();
    if (!type) {
      await options.cms.registerContentType(scope, articleSchema, s.principal);
    }
    signal.throwIfAborted();
    if (
      !(await options.setupStore.complete({
        ...record,
        revision: 2,
        state: 'complete',
      }))
    ) {
      throw new ResponseError(409);
    }
  }
  /** Admit one request under fixed scope/origin and return sanitized application responses.
   * @param {Request} request - Host transport-bound request; identity is verified afresh.
   * @returns {Promise<Response>} Private response after actual handler settlement.
   */
  const handle = (request: Request) =>
    run(async () => {
      try {
        request = new Request(request, {
          signal: AbortSignal.any([request.signal, controller.signal]),
        });
        request.signal.throwIfAborted();
        /** Request URL checked against the configured exact origin and bounded route path. */
        const url = new URL(request.url);
        if (url.origin !== origin.origin || url.pathname.length > 256) {
          throw new ResponseError(403);
        }
        /** Application-local route suffix selected only after mount/origin validation. */
        const relative = url.pathname.slice(base.length);
        /** Fixed supported route suffixes; no saved definition can add executable handlers. */
        const routes = [
          '/setup',
          '/login',
          '/logout',
          '/admin',
          '/editor',
          '/save',
          '/publish',
          '/preview',
          '/page',
        ];
        if (
          (base && !url.pathname.startsWith(base + '/')) ||
          !routes.includes(relative)
        ) {
          throw new ResponseError(404);
        }
        if (!['GET', 'HEAD', 'POST'].includes(request.method)) {
          throw new ResponseError(405);
        }
        if (
          request.method === 'POST' &&
          request.headers.get('origin') !== origin.origin
        ) {
          throw new ResponseError(403);
        }
        /** Durable setup state read before allowing the configured public/editor workflow. */
        const setup = await options.setupStore.read(setupId);
        if (relative === '/page') {
          if (!['GET', 'HEAD'].includes(request.method)) {
            throw new ResponseError(405);
          }
          if (setup?.state !== 'complete') {
            throw new ResponseError(404);
          }
          /** Core-authorized published immutable revision; absence remains a real missing page. */
          const published = await options.cms.readPublished(
            scope,
            entryId,
            options.publicPrincipal
          );
          if (!published) {
            throw new ResponseError(404);
          }
          /** Fresh response-owned headers carrying only reviewed policy/cookies. */
          const hd = headers(false);
          return html(
            request,
            theme.name,
            h(
              'article',
              { 'data-brand-version': theme.brand?.versionId },
              h('h2', null, String(published.values.title)),
              h('p', null, String(published.values.body))
            ),
            hd
          );
        }
        /** Host-verified borrowed session proof; core authorization rechecks its principal. */
        const s = await session(request);
        if (relative === '/login') {
          if (request.method === 'POST') {
            if (!(await options.admit(request, 'login'))) {
              throw new ResponseError(429);
            }
            /** Strict validated form strings; private credentials and content are not echoed on errors. */
            const data = await parse(request, ['csrf', 'username', 'password']);
            await verify(request, null, data);
            if (
              !data.username ||
              !data.password ||
              data.username.length > 128 ||
              data.password.length > 512
            ) {
              throw new ResponseError(400);
            }
            /** Bounded renderer/auth/operation result; private failures are never echoed. */
            const result = await options.login(
              { username: data.username, password: data.password },
              request
            );
            if (!result) {
              throw new ResponseError(401);
            }
            return redirect(
              path(setup?.state === 'complete' ? '/admin' : '/setup'),
              result.cookie
            );
          }
          /** Validated host CSRF token and response headers for this exact form. */
          const c = await csrf(request, null);
          return html(
            request,
            'Sign in',
            form(path('/login'), c.token, [
              field('username', 'Username'),
              field('password', 'Password', 'password'),
              button('Sign in'),
            ]),
            c.headers
          );
        }
        if (!s) {
          return redirect(path('/login'));
        }
        if (relative === '/setup') {
          await permit('setup', s, request);
          if (setup) {
            throw new ResponseError(409);
          }
          if (request.method === 'POST') {
            if (!(await options.admit(request, 'setup'))) {
              throw new ResponseError(429);
            }
            /** Strict validated form strings; private credentials and content are not echoed on errors. */
            const data = await parse(request, ['csrf', 'secret']);
            await verify(request, s, data);
            if (
              !data.secret ||
              data.secret.length > 512 ||
              (await options.verifySetupSecret(data.secret, s, request)) !==
                true
            ) {
              throw new ResponseError(403);
            }
            /** Durable claim/recovery journal fact without setup secrets or credential payloads. */
            const record: SetupRecord = {
              schema: 1,
              scope: setupId,
              claim: randomBytes(32).toString('hex'),
              revision: 1,
              state: 'claimed',
              createdAt: Date.now(),
            };
            if (!(await options.setupStore.claim(record))) {
              throw new ResponseError(409);
            }
            request.signal.throwIfAborted();
            await provision(record, s, request.signal);
            return redirect(path('/admin'));
          }
          /** Validated host CSRF token and response headers for this exact form. */
          const c = await csrf(request, s);
          return html(
            request,
            'Initialize site',
            form(path('/setup'), c.token, [
              field('secret', 'Setup secret', 'password'),
              button('Initialize once'),
            ]),
            c.headers
          );
        }
        if (setup?.state !== 'complete') {
          throw new ResponseError(409);
        }
        if (relative === '/logout') {
          if (request.method !== 'POST') {
            throw new ResponseError(405);
          }
          /** Strict validated form strings; private credentials and content are not echoed on errors. */
          const data = await parse(request, ['csrf']);
          await verify(request, s, data);
          return redirect(
            path('/login'),
            (await options.logout(s, request)).cookie
          );
        }
        /** Fixed route-to-host authorization action; never a browser role claim. */
        let action: Parameters<ZenixOptions['authorize']>[0];
        if (relative === '/publish') {
          action = 'publish';
        } else if (relative === '/save' || relative === '/editor') {
          action = 'edit';
        } else if (relative === '/preview') {
          action = 'preview';
        } else {
          action = 'dashboard';
        }

        await permit(action, s, request);
        if (request.method === 'POST') {
          if (!['/save', '/publish', '/preview'].includes(relative)) {
            throw new ResponseError(405);
          }
          /** Exact required input names for this supported mutation, never client-selected schema fields. */
          const fields =
            relative === '/save'
              ? ['csrf', 'expected', 'title', 'body']
              : ['csrf', 'expected'];
          /** Strict validated form strings; private credentials and content are not echoed on errors. */
          const data = await parse(request, fields);
          await verify(request, s, data);
          // The strict form schema above requires every selected field, including expected.
          if (!/^(?:0|[1-9][0-9]{0,5})$/.test(data.expected!)) {
            throw new ResponseError(400);
          }
          /** Validated optimistic head revision; stale writes remain explicit conflicts. */
          const expected = Number(data.expected);
          if (relative === '/save') {
            await options.cms.saveDraft(
              scope,
              entryId,
              expected || null,
              {
                type: 'article',
                typeVersion: 1,
                // The save branch selected and validated both required text fields.
                values: { title: data.title!, body: data.body! },
              },
              s.principal
            );
            return redirect(path('/editor'));
          }
          if (relative === '/publish') {
            await options.cms.publish(scope, entryId, expected, s.principal);
            return redirect(path('/admin'));
          }
          /** Core-authorized persisted site/entry state; drafts never substitute for published content. */
          const current = await options.cms.readEntry(
            scope,
            entryId,
            s.principal
          );
          if (!current || current.entry.head !== expected) {
            throw new ResponseError(409);
          }
          for (const [key, value] of preview) {
            if (value.expiresAt <= Date.now()) {
              preview.delete(key);
            }
          }
          if (preview.size >= 128) {
            throw new ResponseError(503);
          }
          /** High-entropy expiring preview capability still requiring fresh session/core access. */
          const token = randomBytes(32).toString('hex');
          preview.set(token, {
            session: s.key,
            revision: expected,
            expiresAt: Date.now() + 60000,
          });
          return redirect(path('/preview') + '?token=' + token);
        }
        if (relative === '/preview') {
          /** High-entropy expiring preview capability still requiring fresh session/core access. */
          const token = url.searchParams.get('token') ?? '';
          /** Private preview record bound to the verified session and saved revision. */
          const p = preview.get(token);
          if (!p || p.session !== s.key || p.expiresAt <= Date.now()) {
            throw new ResponseError(404);
          }
          /** Core-authorized immutable saved revision used by the private preview. */
          const revision = await options.cms.readRevision(
            scope,
            entryId,
            p.revision,
            s.principal
          );
          return html(
            request,
            'Private preview',
            h(
              'article',
              null,
              h('h2', null, String(revision.values.title)),
              h('p', null, String(revision.values.body))
            )
          );
        }
        if (!['/admin', '/editor'].includes(relative)) {
          throw new ResponseError(405);
        }
        /** Core-authorized persisted site/entry state; drafts never substitute for published content. */
        const current = await options.cms.readEntry(
          scope,
          entryId,
          s.principal
        );
        /** Validated host CSRF token and response headers for this exact form. */
        const c = await csrf(request, s);
        /** Validated optimistic head revision; stale writes remain explicit conflicts. */
        const expected = String(current?.entry.head ?? 0);
        if (relative === '/editor') {
          return html(
            request,
            'Content editor',
            h(
              'section',
              null,
              form(path('/save'), c.token, [
                hidden('expected', expected),
                field(
                  'title',
                  'Title',
                  'text',
                  String(current?.revision.values.title ?? '')
                ),
                h(
                  'div',
                  null,
                  h('label', { for: 'body' }, 'Body'),
                  h(
                    'textarea',
                    {
                      id: 'body',
                      name: 'body',
                      required: true,
                      'aria-label': label('Body').label,
                    },
                    String(current?.revision.values.body ?? '')
                  )
                ),
                button('Save draft'),
              ]),
              current
                ? form(path('/preview'), c.token, [
                    hidden('expected', expected),
                    button('Preview saved revision'),
                  ])
                : null
            ),
            c.headers
          );
        }
        return html(
          request,
          'Dashboard',
          h(
            'section',
            null,
            h('p', null, 'Latest revision: ' + expected),
            h(
              'p',
              null,
              'Published revision: ' +
                String(current?.entry.publishedRevision ?? 'None')
            ),
            h('a', { href: path('/editor') }, 'Edit content'),
            h('a', { href: path('/page') }, 'Published page'),
            current
              ? form(path('/publish'), c.token, [
                  hidden('expected', expected),
                  button('Publish saved revision'),
                ])
              : null,
            form(path('/logout'), c.token, [button('Sign out')])
          ),
          c.headers
        );
      } catch (error) {
        /** Fixed sanitized failure classification; private causes stay server-side. */
        let status: number;
        if (error instanceof ResponseError) {
          status = error.status;
        } else if (error instanceof CmsError) {
          if (error.code === 'DENIED' || error.code === 'MEDIA_DENIED') {
            status = 403;
          } else if (error.code === 'REVISION_CONFLICT') {
            status = 409;
          } else if (
            error.code.startsWith('INVALID') ||
            error.code === 'CONTENT_SIZE'
          ) {
            status = 400;
          } else {
            status = 503;
          }
        } else if (error instanceof HttpValidationError) {
          status = error.status;
        } else {
          status = 503;
        }

        /** Fixed response text; no private error or submitted value enters the body. */
        let message: string;
        if (status === 409) {
          message = 'Conflict; reload or contact the operator';
        } else if (status === 403) {
          message = 'Access denied';
        } else if (status === 401) {
          message = 'Sign in failed';
        } else if (status === 404) {
          message = 'Not found';
        } else {
          message = 'Request unavailable';
        }

        return new Response(message, { status, headers: headers() });
      }
    })
      .catch(
        () =>
          new Response('Request unavailable', {
            status: 503,
            headers: headers(),
          })
      )
      .then((response) =>
        request.method === 'HEAD'
          ? new Response(null, {
              status: response.status,
              headers: response.headers,
            })
          : response
      );
  return {
    handle,
    /** Install explicit Fetch handlers into the host generation without starting a listener.
     * @param {ZeruxPluginApi} api - Trusted generation-owned registration API.
     * @returns {void} Registers routes; application lifetime remains owned by the host.
     */
    install(api: ZeruxPluginApi) {
      registerFetchRoutes(
        api,
        [
          '/setup',
          '/login',
          '/logout',
          '/admin',
          '/editor',
          '/save',
          '/publish',
          '/preview',
          '/page',
        ].map((suffix) => ({
          path: path(suffix),
          handler: async (request, context) => {
            if (context.req.headers.host !== origin.host) {
              return new Response('Access denied', {
                status: 403,
                headers: headers(),
              });
            }
            // Zerux Fetch routes intentionally use a neutral URL; bind only to the reviewed fixed origin.
            /** Owned transport cancellation controller for this framework Fetch binding. */
            const aborter = new AbortController();
            /** Forward downstream disconnection cooperatively into this request.
             * @returns {void} Aborts only this owned request lifetime.
             */
            const abort = () => aborter.abort();
            context.req.once('aborted', abort);
            context.res.once('close', abort);
            try {
              /** Explicit reviewed request transport init; forwarded headers do not establish identity. */
              const init: RequestInit & { duplex?: 'half' } = {
                method: request.method,
                headers: request.headers,
                signal: aborter.signal,
              };
              if (!['GET', 'HEAD'].includes(request.method)) {
                init.body = request.body;
                init.duplex = 'half';
              }
              return await handle(
                new Request(
                  new URL(
                    new URL(request.url).pathname + new URL(request.url).search,
                    origin.origin
                  ),
                  init
                )
              );
            } finally {
              context.req.off('aborted', abort);
              context.res.off('close', abort);
            }
          },
        }))
      );
    },
    /** Resume an existing durable claim only after fresh host operator proof.
     * @param {ZenixSession} s - Verified operator session reauthorized for setup.
     * @param {unknown} evidence - Private recovery proof bound by the host to this claim.
     * @returns {Promise<void>} Reconciles fixed site/schema and completes the original claim; no automatic reset or replay.
     */
    recoverSetup(s: ZenixSession, evidence: unknown) {
      return run(async () => {
        /** Durable claim/recovery journal fact without setup secrets or credential payloads. */
        const record = await options.setupStore.read(setupId);
        if (!record || record.state !== 'claimed') {
          throw new ResponseError(409);
        }
        await permit('setup', s);
        if (
          (await options.authorizeRecovery(evidence, s, record.claim)) !== true
        ) {
          throw new ResponseError(403);
        }
        await provision(record, s);
      });
    },
    /** Reject admission, abort cooperatively, clear previews and drain owned readers/handlers/renderer.
     * @returns {Promise<void>} Memoized actual teardown settlement; borrowed core/auth/setup connectors stay open.
     */
    close() {
      if (closing) {
        return closing;
      }
      closed = true;
      controller.abort();
      preview.clear();
      return (closing = (async () => {
        await input.close();
        await Promise.allSettled([...pending]);
        // An already admitted preview may have settled after the initial cancellation.
        preview.clear();
        await registry.close();
      })());
    },
  };
}
