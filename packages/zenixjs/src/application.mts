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
export interface ZenixSession {
  /** Private server session/proof supplied to core resolvePrincipal. */ principal: unknown;
  /** Opaque nonsecret binding, never a browser role or raw cookie. */ key: string;
}
export interface ZenixOptions {
  cms: Cms;
  scope: CmsScope;
  setupStore: SetupStore;
  origin: string;
  basePath: string;
  entryId: string;
  /** Fixed host-owned read-only core identity; never derived from public request data. */
  publicPrincipal: unknown;
  authenticate(request: Request): Promise<ZenixSession | null>;
  login(
    input: { username: string; password: string },
    request: Request,
  ): Promise<{ cookie: string } | null>;
  logout(session: ZenixSession, request: Request): Promise<{ cookie: string }>;
  authorize(
    action: 'setup' | 'dashboard' | 'edit' | 'preview' | 'publish',
    session: ZenixSession,
    request?: Request,
  ): Promise<boolean>;
  csrf: {
    issue(
      request: Request,
      session: ZenixSession | null,
    ): Promise<{ token: string; cookie?: string }>;
    verify(
      request: Request,
      session: ZenixSession | null,
      token: string,
    ): Promise<boolean>;
  };
  /** Constant-time host secret check plus fresh setup privilege. No bundled administrator/password. */
  verifySetupSecret(
    secret: string,
    session: ZenixSession,
    request: Request,
  ): Promise<boolean>;
  /** Trusted operator-only procedure; never mounted as an HTTP route. */
  authorizeRecovery(
    evidence: unknown,
    session: ZenixSession,
    claim: string,
  ): Promise<boolean>;
  /** Host rate/admission policy for login and setup; no loopback exemption. */
  admit(request: Request, action: 'login' | 'setup'): Promise<boolean>;
  theme?: {
    name: string;
    brand?: Pick<BrandVersion, 'versionId' | 'assetId' | 'hash'>;
  };
}
const articleSchema = {
  id: 'article',
  version: 1,
  fields: {
    title: { kind: 'text' as const, required: true, maxLength: 200 },
    body: { kind: 'text' as const, required: true, maxLength: 8192 },
  },
};
class ResponseError extends Error {
  constructor(readonly status: number) {
    super('Zenix request rejected');
  }
}
const allowedName = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(v);
const label = (text: string): LabelledComponentProps => ({ label: text });
const field = (name: string, text: string, type = 'text', value = '') =>
  h(
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
      autocomplete:
        name === 'secret'
          ? 'off'
          : type === 'password'
            ? 'current-password'
            : name === 'username'
              ? 'username'
              : 'off',
    }),
  );
const hidden = (name: string, value: string) =>
  h('input', { type: 'hidden', name, value });
const form = (action: string, csrf: string, children: VNodeChild[]) =>
  h('form', { method: 'post', action }, hidden('csrf', csrf), ...children);
const button = (text: string) => h('button', { type: 'submit' }, text);
function cookie(headers: Headers, value: string | undefined) {
  if (value !== undefined) {
    if (
      typeof value !== 'string' ||
      !value ||
      value.length > 8192 ||
      /[\r\n]/.test(value)
    )
      throw new ResponseError(500);
    headers.append('set-cookie', value);
  }
}
/** Opt-in SSR application. All CMS/auth/stores are borrowed and explicitly configured. */
export function createZenixApplication(options: ZenixOptions) {
  if (
    !options ||
    !allowedName(options.scope?.tenant) ||
    !allowedName(options.scope?.site) ||
    !allowedName(options.entryId) ||
    !/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(options.basePath) ||
    (options.basePath.endsWith('/') && options.basePath !== '/')
  )
    throw new TypeError('Invalid fixed Zenix scope/path');
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
        ].includes(k),
    )
  )
    throw new TypeError('Unknown Zenix configuration');
  const origin = new URL(options.origin);
  if (
    origin.origin !== options.origin ||
    !['http:', 'https:'].includes(origin.protocol)
  )
    throw new TypeError('Exact public origin required');
  if (
    options.setupStore?.contract !== 'zenix-setup-cas-v1' ||
    options.setupStore.durability !== 'durable' ||
    ['read', 'claim', 'complete'].some(
      (k) => typeof (options.setupStore as any)[k] !== 'function',
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
  )
    throw new TypeError('Explicit CMS and host security contracts required');
  const scope = { ...options.scope },
    base = options.basePath === '/' ? '' : options.basePath,
    path = (suffix: string) => base + suffix,
    setupId = setupScope(scope.tenant, scope.site),
    entryId = options.entryId;
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
  )
    throw new TypeError('Invalid pinned theme brand reference');
  const policy = createSecurityPolicy({
    mode: 'production',
    https: origin.protocol === 'https:',
  });
  const registry = createRendererRegistry({
      maxBytes: 131072,
      maxActive: 8,
      timeoutMs: 5000,
    }),
    renderer = registry.register(
      createZyroRenderer<VNodeChild>(renderToString),
    );
  const input = createHttpInputAdapter({
    maxBytes: 20000,
    maxFields: 6,
    maxFieldBytes: 10000,
    duplicates: 'reject',
    files: 'reject',
    bodyTimeoutMs: 3000,
    maxConcurrentReads: 8,
  });
  const preview = new Map<
    string,
    { session: string; revision: number; expiresAt: number }
  >();
  const controller = new AbortController(),
    pending = new Set<Promise<unknown>>();
  let closed = false,
    closing: Promise<void> | undefined;
  const run = <T,>(fn: () => Promise<T>): Promise<T> => {
    if (closed) return Promise.reject(new ResponseError(503));
    if (pending.size >= 8) return Promise.reject(new ResponseError(503));
    const work = Promise.resolve()
      .then(fn)
      .finally(() => pending.delete(work));
    pending.add(work);
    return work;
  };
  const headers = (privatePage = true) => {
    const result = new Headers(policy.createResponse().headers);
    result.set('cache-control', 'private, no-store');
    result.set('referrer-policy', 'no-referrer');
    if (privatePage) result.set('x-robots-tag', 'noindex, nofollow, noarchive');
    return result;
  };
  const redirect = (to: string, extraCookie?: string) => {
    const hd = headers();
    hd.set('location', to);
    cookie(hd, extraCookie);
    return new Response(null, { status: 303, headers: hd });
  };
  const html = async (
    request: Request,
    title: string,
    body: VNodeChild,
    hd = headers(),
  ) => {
    controller.signal.throwIfAborted();
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
        h('title', null, title),
      ),
      h(
        'body',
        null,
        h('a', { href: '#main' }, 'Skip to content'),
        h('main', { id: 'main', tabindex: '-1' }, h('h1', null, title), body),
      ),
    );
    const result = await registry.render(renderer, doc, {
      requestId: randomUUID(),
      pathname: new URL(request.url).pathname,
      signal: request.signal,
    });
    if (!isRenderedHtml(result)) throw new ResponseError(500);
    hd.set('content-type', 'text/html; charset=utf-8');
    return new Response('<!doctype html>' + result.html, { headers: hd });
  };
  const session = async (request: Request) => {
    const s = await options.authenticate(request);
    if (
      s &&
      (typeof s.key !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(s.key))
    )
      throw new ResponseError(403);
    return s;
  };
  const permit = async (
    action: Parameters<ZenixOptions['authorize']>[0],
    s: ZenixSession,
    request?: Request,
  ) => {
    if ((await options.authorize(action, s, request)) !== true)
      throw new ResponseError(403);
    controller.signal.throwIfAborted();
    request?.signal.throwIfAborted();
  };
  const csrf = async (req: Request, s: ZenixSession | null) => {
    const issued = await options.csrf.issue(req, s);
    if (
      typeof issued.token !== 'string' ||
      !issued.token ||
      issued.token.length > 256
    )
      throw new ResponseError(500);
    const hd = headers();
    cookie(hd, issued.cookie);
    return { token: issued.token, headers: hd };
  };
  async function parse(req: Request, fields: readonly string[]) {
    if (
      req.headers.get('content-type')?.split(';')[0].trim() !==
      'application/x-www-form-urlencoded'
    )
      throw new ResponseError(415);
    const schema = strictObject(
      Object.fromEntries(fields.map((k) => [k, string()])),
    );
    return (await input.parseFormRequest(schema, req)) as Record<
      string,
      string
    >;
  }
  async function verify(
    req: Request,
    s: ZenixSession | null,
    data: Record<string, string>,
  ) {
    if (
      !data.csrf ||
      data.csrf.length > 256 ||
      (await options.csrf.verify(req, s, data.csrf)) !== true
    )
      throw new ResponseError(403);
    req.signal.throwIfAborted();
  }
  async function provision(
    record: SetupRecord,
    s: ZenixSession,
    signal: AbortSignal = controller.signal,
  ) {
    signal.throwIfAborted();
    const current = await options.cms.readSite(scope, s.principal);
    if (current && current.name !== theme.name) throw new ResponseError(409);
    signal.throwIfAborted();
    if (!current) await options.cms.createSite(scope, theme.name, s.principal);
    signal.throwIfAborted();
    const type = await options.cms.readContentType(
      scope,
      'article',
      1,
      s.principal,
    );
    if (type && JSON.stringify(type) !== JSON.stringify(articleSchema))
      throw new ResponseError(409);
    signal.throwIfAborted();
    if (!type)
      await options.cms.registerContentType(scope, articleSchema, s.principal);
    signal.throwIfAborted();
    if (
      !(await options.setupStore.complete({
        ...record,
        revision: 2,
        state: 'complete',
      }))
    )
      throw new ResponseError(409);
  }
  const handle = (request: Request) =>
    run(async () => {
      try {
        request = new Request(request, {
          signal: AbortSignal.any([request.signal, controller.signal]),
        });
        request.signal.throwIfAborted();
        const url = new URL(request.url);
        if (url.origin !== origin.origin || url.pathname.length > 256)
          throw new ResponseError(403);
        const relative = url.pathname.slice(base.length);
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
        )
          throw new ResponseError(404);
        if (!['GET', 'HEAD', 'POST'].includes(request.method))
          throw new ResponseError(405);
        if (
          request.method === 'POST' &&
          request.headers.get('origin') !== origin.origin
        )
          throw new ResponseError(403);
        const setup = await options.setupStore.read(setupId);
        if (relative === '/page') {
          if (!['GET', 'HEAD'].includes(request.method))
            throw new ResponseError(405);
          if (setup?.state !== 'complete') throw new ResponseError(404);
          const published = await options.cms.readPublished(
            scope,
            entryId,
            options.publicPrincipal,
          );
          if (!published) throw new ResponseError(404);
          const hd = headers(false);
          return html(
            request,
            theme.name,
            h(
              'article',
              { 'data-brand-version': theme.brand?.versionId },
              h('h2', null, String(published.values.title)),
              h('p', null, String(published.values.body)),
            ),
            hd,
          );
        }
        const s = await session(request);
        if (relative === '/login') {
          if (request.method === 'POST') {
            if (!(await options.admit(request, 'login')))
              throw new ResponseError(429);
            const data = await parse(request, ['csrf', 'username', 'password']);
            await verify(request, null, data);
            if (
              !data.username ||
              !data.password ||
              data.username.length > 128 ||
              data.password.length > 512
            )
              throw new ResponseError(400);
            const result = await options.login(
              { username: data.username, password: data.password },
              request,
            );
            if (!result) throw new ResponseError(401);
            return redirect(
              path(setup?.state === 'complete' ? '/admin' : '/setup'),
              result.cookie,
            );
          }
          const c = await csrf(request, null);
          return html(
            request,
            'Sign in',
            form(path('/login'), c.token, [
              field('username', 'Username'),
              field('password', 'Password', 'password'),
              button('Sign in'),
            ]),
            c.headers,
          );
        }
        if (!s) return redirect(path('/login'));
        if (relative === '/setup') {
          await permit('setup', s, request);
          if (setup) throw new ResponseError(409);
          if (request.method === 'POST') {
            if (!(await options.admit(request, 'setup')))
              throw new ResponseError(429);
            const data = await parse(request, ['csrf', 'secret']);
            await verify(request, s, data);
            if (
              !data.secret ||
              data.secret.length > 512 ||
              (await options.verifySetupSecret(data.secret, s, request)) !==
                true
            )
              throw new ResponseError(403);
            const record: SetupRecord = {
              schema: 1,
              scope: setupId,
              claim: randomBytes(32).toString('hex'),
              revision: 1,
              state: 'claimed',
              createdAt: Date.now(),
            };
            if (!(await options.setupStore.claim(record)))
              throw new ResponseError(409);
            request.signal.throwIfAborted();
            await provision(record, s, request.signal);
            return redirect(path('/admin'));
          }
          const c = await csrf(request, s);
          return html(
            request,
            'Initialize site',
            form(path('/setup'), c.token, [
              field('secret', 'Setup secret', 'password'),
              button('Initialize once'),
            ]),
            c.headers,
          );
        }
        if (setup?.state !== 'complete') throw new ResponseError(409);
        if (relative === '/logout') {
          if (request.method !== 'POST') throw new ResponseError(405);
          const data = await parse(request, ['csrf']);
          await verify(request, s, data);
          return redirect(
            path('/login'),
            (await options.logout(s, request)).cookie,
          );
        }
        const action =
          relative === '/publish'
            ? 'publish'
            : relative === '/save' || relative === '/editor'
              ? 'edit'
              : relative === '/preview'
                ? 'preview'
                : 'dashboard';
        await permit(action, s, request);
        if (request.method === 'POST') {
          if (!['/save', '/publish', '/preview'].includes(relative))
            throw new ResponseError(405);
          const fields =
            relative === '/save'
              ? ['csrf', 'expected', 'title', 'body']
              : ['csrf', 'expected'];
          const data = await parse(request, fields);
          await verify(request, s, data);
          if (!/^(?:0|[1-9][0-9]{0,5})$/.test(data.expected))
            throw new ResponseError(400);
          const expected = Number(data.expected);
          if (relative === '/save') {
            await options.cms.saveDraft(
              scope,
              entryId,
              expected || null,
              {
                type: 'article',
                typeVersion: 1,
                values: { title: data.title, body: data.body },
              },
              s.principal,
            );
            return redirect(path('/editor'));
          }
          if (relative === '/publish') {
            await options.cms.publish(scope, entryId, expected, s.principal);
            return redirect(path('/admin'));
          }
          const current = await options.cms.readEntry(
            scope,
            entryId,
            s.principal,
          );
          if (!current || current.entry.head !== expected)
            throw new ResponseError(409);
          for (const [key, value] of preview)
            if (value.expiresAt <= Date.now()) preview.delete(key);
          if (preview.size >= 128) throw new ResponseError(503);
          const token = randomBytes(32).toString('hex');
          preview.set(token, {
            session: s.key,
            revision: expected,
            expiresAt: Date.now() + 60000,
          });
          return redirect(path('/preview') + '?token=' + token);
        }
        if (relative === '/preview') {
          const token = url.searchParams.get('token') ?? '',
            p = preview.get(token);
          if (!p || p.session !== s.key || p.expiresAt <= Date.now())
            throw new ResponseError(404);
          const revision = await options.cms.readRevision(
            scope,
            entryId,
            p.revision,
            s.principal,
          );
          return html(
            request,
            'Private preview',
            h(
              'article',
              null,
              h('h2', null, String(revision.values.title)),
              h('p', null, String(revision.values.body)),
            ),
          );
        }
        if (!['/admin', '/editor'].includes(relative))
          throw new ResponseError(405);
        const current = await options.cms.readEntry(
            scope,
            entryId,
            s.principal,
          ),
          c = await csrf(request, s),
          expected = String(current?.entry.head ?? 0);
        if (relative === '/editor')
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
                  String(current?.revision.values.title ?? ''),
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
                    String(current?.revision.values.body ?? ''),
                  ),
                ),
                button('Save draft'),
              ]),
              current
                ? form(path('/preview'), c.token, [
                    hidden('expected', expected),
                    button('Preview saved revision'),
                  ])
                : null,
            ),
            c.headers,
          );
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
                String(current?.entry.publishedRevision ?? 'None'),
            ),
            h('a', { href: path('/editor') }, 'Edit content'),
            h('a', { href: path('/page') }, 'Published page'),
            current
              ? form(path('/publish'), c.token, [
                  hidden('expected', expected),
                  button('Publish saved revision'),
                ])
              : null,
            form(path('/logout'), c.token, [button('Sign out')]),
          ),
          c.headers,
        );
      } catch (error) {
        const status =
          error instanceof ResponseError
            ? error.status
            : error instanceof CmsError
              ? error.code === 'DENIED' || error.code === 'MEDIA_DENIED'
                ? 403
                : error.code === 'REVISION_CONFLICT'
                  ? 409
                  : error.code.startsWith('INVALID') ||
                      error.code === 'CONTENT_SIZE'
                    ? 400
                    : 503
              : error instanceof HttpValidationError
                ? error.status
                : 503;
        return new Response(
          status === 409
            ? 'Conflict; reload or contact the operator'
            : status === 403
              ? 'Access denied'
              : status === 401
                ? 'Sign in failed'
                : status === 404
                  ? 'Not found'
                  : 'Request unavailable',
          { status, headers: headers() },
        );
      }
    })
      .catch(
        () =>
          new Response('Request unavailable', {
            status: 503,
            headers: headers(),
          }),
      )
      .then((response) =>
        request.method === 'HEAD'
          ? new Response(null, {
              status: response.status,
              headers: response.headers,
            })
          : response,
      );
  return {
    handle,
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
            if (context.req.headers.host !== origin.host)
              return new Response('Access denied', {
                status: 403,
                headers: headers(),
              });
            // Zerux Fetch routes intentionally use a neutral URL; bind only to the reviewed fixed origin.
            const aborter = new AbortController(),
              abort = () => aborter.abort();
            context.req.once('aborted', abort);
            context.res.once('close', abort);
            try {
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
                    origin.origin,
                  ),
                  init,
                ),
              );
            } finally {
              context.req.off('aborted', abort);
              context.res.off('close', abort);
            }
          },
        })),
      );
    },
    recoverSetup(s: ZenixSession, evidence: unknown) {
      return run(async () => {
        const record = await options.setupStore.read(setupId);
        if (!record || record.state !== 'claimed') throw new ResponseError(409);
        await permit('setup', s);
        if (
          (await options.authorizeRecovery(evidence, s, record.claim)) !== true
        )
          throw new ResponseError(403);
        await provision(record, s);
      });
    },
    close() {
      if (closing) return closing;
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
