import { mkdir, lstat, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { createCompressionOwner } from 'zhost/compression';
import { forwardPerformanceResponse } from '@zeruxjs/performance/response';
import { createHash, randomUUID } from 'node:crypto';
import { createConnector } from '@zeruxjs/db-sqlite';
import { h } from 'zyrojs/component';
import { createSearchIndex } from '@zeruxjs/search';
import { createFeedResponse } from '@zeruxjs/feed';
import { createSitemap } from '@zeruxjs/seo';
import { createFileManager, createLocalStorage } from '@zeruxjs/files';
import { createMemoryCacheHelper } from '@zeruxjs/cache';
import { createHttpInputAdapter, HttpValidationError } from '@zeruxjs/validator/http';
import { strictObject, string } from '@zeruxjs/validator/schemas';
import { registerFetchRoutes, type ZeruxPluginApi } from 'zeruxjs';
import { createProtocolGateway, createMcpServer, SseHub } from 'zhost/protocols';
import { createWorkspaceIdentity, validateIdentityOptions, type IdentityOptions, type WorkspaceSession } from './auth.js';
import { createNotebook, WorkspaceError } from './store.js';
import type { ServerLifecycleHooks } from '@zeruxjs/hooks/lifecycle';
import { headers, html } from './view.js';
import { createWorkspaceAnalytics } from './analytics.js';
import { createWorkspaceAssets } from './assets.js';
import { createShortLinkService } from '@zeruxjs/share/server';
import { createSqliteShortLinkStore } from '@zeruxjs/share/sqlite';
import { createTemplateRegistry } from '@zeruxjs/email';
import { createExperimentCatalog, createExperimentEvaluator } from 'ztrial/experiments';
export { workspaceUnavailable } from './view.js';

export interface WorkspaceOptions extends IdentityOptions { directory: string; migrate?: boolean }
const field = (name: string, label: string, value = '', type = 'text') => h('label', null, label, h('input', { name, type, value, required: true }));
const hidden = (name: string, value: string) => h('input', { type: 'hidden', name, value });
const submit = (text: string) => h('button', { type: 'submit' }, text);
const link = (href: string, text: string) => h('a', { href }, text);

/** All resources are generation owned. Importing this module creates no files or listeners. */
export async function createWorkspace(options: WorkspaceOptions) {
  validateIdentityOptions(options);
  const dataScope = createHash('sha256').update(JSON.stringify([options.tenant, options.site])).digest('hex');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(options.tenant) || !/^[A-Za-z0-9_-]{1,64}$/.test(options.site)) throw new Error('WORKSPACE_SCOPE_INVALID');
  const directory = resolve(options.directory);
  for (let cursor = directory; ; cursor = resolve(cursor, '..')) {
    const stat = await lstat(cursor).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error('WORKSPACE_DIRECTORY_UNSAFE');
    if (cursor === resolve(cursor, '..')) break;
  }
  if (options.migrate) await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).mode & 0o077) throw new Error('WORKSPACE_DIRECTORY_MUST_BE_PRIVATE');
  const filename = resolve(directory, 'workspace.sqlite');
  const file = await lstat(filename).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
  if (file && (!file.isFile() || file.isSymbolicLink())) throw new Error('WORKSPACE_DATABASE_UNSAFE');
  if (!options.migrate && !file) throw new Error('WORKSPACE_INITIALIZATION_REQUIRED');
  const db = await createConnector({ filename, driver: 'node', busyTimeoutMs: 1000, journalMode: 'wal' });
  let identity: ReturnType<typeof createWorkspaceIdentity> | undefined;
  let files: ReturnType<typeof createFileManager> | undefined;
  let gateway: ReturnType<typeof createProtocolGateway> | undefined;
  let shortLinks: ReturnType<typeof createShortLinkService> | undefined;
  let experiments: ReturnType<typeof createExperimentEvaluator> | undefined;
  let telemetry: Awaited<ReturnType<typeof createWorkspaceAnalytics>> | undefined;
  const input = createHttpInputAdapter({ maxBytes: 20_000, maxFields: 8, maxFieldBytes: 10000, duplicates: 'reject', files: 'reject', bodyTimeoutMs: 3000, maxConcurrentReads: 8 });
  const cache = createMemoryCacheHelper({ maxEntries: 8 });
  const measurements: Array<{encoding: string; outputBytes: number; durationMs: number; outcome: string}> = [];
  const compression = createCompressionOwner({ encodings: ['br', 'gzip'], maxConcurrent: 2, onMeasure: measurement => { measurements.push({ ...measurement }); if (measurements.length > 16) measurements.shift(); } });
  let closed = false, closing: Promise<void> | undefined;
  const pending = new Set<Promise<unknown>>();
  const lifecycleCounts: Record<string, number> = {};
  const lifecycleDisposers: Array<() => void> = [];
  const close = () => closing ??= (async () => {
    closed = true; for (const dispose of lifecycleDisposers.splice(0)) dispose(); gateway?.close(); input.close();
    const compressionClosed = compression.close();
    await Promise.allSettled([...pending]);
    const failures: unknown[] = [];
    try { await compressionClosed; } catch (error) { failures.push(error); }
    for (const dispose of [() => experiments?.close(), () => shortLinks?.close(), () => telemetry?.close(), () => identity?.close(), () => files?.close(), () => cache.close?.(), () => db.disconnect()]) {
      try { await dispose(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Workspace cleanup failed');
  })();
  try {
    await chmod(filename, 0o600);
    identity = createWorkspaceIdentity(db, options, options.migrate === true);
    const auth = identity;
    const notebook = createNotebook(db, dataScope, options.migrate === true);
    const analytics = telemetry = await createWorkspaceAnalytics(db, options.tenant, options.site);
    const storageRoot = resolve(directory, 'storage');
    await mkdir(storageRoot, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
    if ((await lstat(storageRoot)).isSymbolicLink()) throw new Error('WORKSPACE_STORAGE_UNSAFE');
    files = createFileManager({ defaultStorage: 'local', stores: [{ name: 'local', driver: createLocalStorage({ root: storageRoot }), allowedBuckets: ['workspace'], keyPrefix: dataScope + '/', maxBytes: 65536, allowedTypes: ['text/plain'] }] });
    const storage = files;
    const assets = createWorkspaceAssets(db, storage, dataScope, options.username, options.migrate === true);
    shortLinks = createShortLinkService({ origin: options.origin, prefix: '/workspace/s/', store: createSqliteShortLinkStore({ database: db, persistent: true, initialize: options.migrate === true }), allowedOrigins: [options.origin], allowDestination: value => { const url = new URL(value); return url.pathname === '/workspace/public' && !url.search; }, authorize: async context => context instanceof Request && await auth.authenticate(context) ? { tenant: dataScope, subject: options.username } : null, defaultTtlMs: 86400000, maxTtlMs: 604800000 });
    const links = shortLinks;
    const templates = createTemplateRegistry([{ id: 'notebook-update', subject: 'Workspace update: {{title}}', html: '<h1>{{title}}</h1><p>{{body}}</p>', text: '{{title}}\n\n{{body}}', layout: 'none' }]);
    const experimentTenant = createHash('sha256').update(options.tenant).digest('hex');
    const experimentCatalog = createExperimentCatalog([{ id: 'workspace-layout', version: 1, salt: 'workspace-layout-v1', variants: [{ name: 'comfortable', weight: 5000 }, { name: 'compact', weight: 3000 }, { name: 'focused', weight: 2000 }], environments: ['local'], migration: 'initial' }]);
    experiments = createExperimentEvaluator({ catalog: experimentCatalog, tenant: experimentTenant, tenantSalt: options.key, resolveContext: async context => {
      if (!(context instanceof Request) || !await auth.authenticate(context)) return null;
      return { tenant: experimentTenant, subject: createHash('sha256').update(options.username).digest('hex'), environment: 'local', consent: 'granted' };
    } });
    const evaluator = experiments;
    const cacheKey = JSON.stringify([options.tenant, options.site, 'published']);
    const published = async () => {
      try {
        const cached = await cache.get(cacheKey);
        if (typeof cached === 'string') return JSON.parse(cached) as ReturnType<typeof notebook.list>;
      } catch { /* Optional cache cannot make authoritative local storage unavailable. */ }
      const notes = notebook.list(true);
      try { await cache.set(cacheKey, JSON.stringify(notes), { ttlSeconds: 15 }); } catch { /* Large valid catalogs can exceed the optional cache budget. */ }
      return notes;
    };
    const protocolRequest = (request: import('node:http').IncomingMessage) => new Request(options.origin + (request.url ?? '/'), { headers: { cookie: String(request.headers.cookie ?? ''), origin: String(request.headers.origin ?? '') } });
    gateway = createProtocolGateway({ events: new SseHub({ maxClients: 8, historySize: 16, heartbeatMs: 1000, privateCache: true }), authorize: async request => !closed && request.headers.host === new URL(options.origin).host && !!await auth.authenticate(protocolRequest(request)), maxBodyBytes: 16_384, maxConcurrentRequests: 8, requestTimeoutMs: 5000, allowedOrigins: [options.origin], authorizeEndpoint: async request => {
      if (closed || request.headers.host !== new URL(options.origin).host) return false;
      const req = protocolRequest(request), session = await auth.authenticate(req);
      if (!session) return false;
      return request.method === 'GET' || request.method === 'HEAD' || await auth.callbacks.csrf.verify(req, session, String(request.headers['x-csrf-token'] ?? ''));
    } });
    const protocols = gateway;
    const summary = (params: unknown) => {
      if (params != null && (typeof params !== 'object' || Array.isArray(params) || Object.keys(params).length)) throw new Error('Expected an empty argument object');
      const records = notebook.list();
      return { notes: records.slice(0, 20).map(({ id, title, revision, published }) => ({ id, title, revision, published })), total: records.length, truncated: records.length > 20, scope: { tenant: options.tenant, site: options.site } };
    };
    protocols.rpc.register('workspace.summary', summary);
    protocols.trpc.register('workspace.summary', summary);
    protocols.connect.register('workspace.Notebook', 'Summary', summary);
    protocols.connectStream.register('workspace.Notebook', 'SummaryStream', async function* (messages, context) {
      let count = 0;
      for await (const message of messages) { if (context.signal?.aborted || ++count > 4) throw new Error('Stream budget exceeded'); yield summary(message); }
    });
    protocols.mcp = createMcpServer({ name: 'zerux-workspace', version: '0.0.4' });
    protocols.mcp.tools.register({ name: 'workspace_summary', description: 'Read titles and revisions in the authenticated workspace. Does not execute content.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, handler: summary });
    protocols.mcp.resources.register({ uri: 'workspace://capabilities', name: 'Workspace capabilities', text: 'Authenticated read-only notebook summary. No model provider, shell, URL fetch or code execution.', mimeType: 'text/plain' });
    const paths = ['/workspace', '/workspace/login', '/workspace/logout', '/workspace/notes', '/workspace/save', '/workspace/files', '/workspace/files/create', '/workspace/files/download', '/workspace/search', '/workspace/public', '/workspace/protocols', '/workspace/feed.json', '/workspace/feed.xml', '/workspace/sitemap.xml', '/workspace/lab', '/workspace/reports', '/workspace/report-data', '/workspace/analytics/record', '/workspace/assets', '/workspace/assets/upload', '/workspace/assets/download', '/workspace/share', '/workspace/share/create', '/workspace/email', '/workspace/email/preview', '/workspace/experiments', '/workspace/experiments/evaluate', '/workspace/tags', '/workspace/tags/dispatch', '/workspace/performance', '/workspace/diagnostics'];
    async function parse(request: Request, fields: string[]) {
      if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/x-www-form-urlencoded') throw new WorkspaceError(415, 'FORM_CONTENT_TYPE_REQUIRED');
      return await input.parseFormRequest(strictObject(Object.fromEntries(fields.map(name => [name, string()]))), request) as Record<string, string>;
    }
    async function formContext(request: Request, session: WorkspaceSession | null) {
      return auth.callbacks.csrf.issue(request, session);
    }
    const redirect = (location: string, cookie?: string) => new Response(null, { status: 303, headers: { ...headers, location, ...(cookie ? { 'set-cookie': cookie } : {}) } });
    const run = async (request: Request): Promise<Response> => {
      if (closed) throw new WorkspaceError(503, 'WORKSPACE_CLOSED');
      const url = new URL(request.url);
      if (url.origin !== options.origin) throw new WorkspaceError(403, 'ORIGIN_DENIED');
      if (url.pathname.startsWith('/workspace/s/')) return links.handler(request);
      if (!paths.includes(url.pathname)) throw new WorkspaceError(404, 'NOT_FOUND');
      if (!['GET', 'HEAD', 'POST'].includes(request.method)) throw new WorkspaceError(405, 'METHOD_DENIED');
      const session = await auth.authenticate(request);
      const privatePath = !['/workspace', '/workspace/login', '/workspace/public', '/workspace/search', '/workspace/feed.json', '/workspace/feed.xml', '/workspace/sitemap.xml'].includes(url.pathname);
      if (privatePath && !session) return redirect('/workspace/login');
      if (request.method === 'POST') {
        if (request.headers.get('origin') !== options.origin) throw new WorkspaceError(403, 'ORIGIN_DENIED');
        if (url.pathname === '/workspace/login') {
          if (!await auth.callbacks.admit(request, 'login')) throw new WorkspaceError(429, 'LOGIN_LIMIT');
          const body = await parse(request, ['csrf', 'username', 'password']);
          if (!await auth.callbacks.csrf.verify(request, null, body.csrf!)) throw new WorkspaceError(403, 'CSRF_DENIED');
          const result = await auth.callbacks.login({ username: body.username!, password: body.password! }, request);
          if (!result) throw new WorkspaceError(403, 'LOGIN_DENIED');
          return redirect('/workspace/notes', result.cookie);
        }
        if (!session || !await auth.callbacks.authorize('write', session)) throw new WorkspaceError(403, 'WRITE_DENIED');
        if (url.pathname === '/workspace/logout') {
          const body = await parse(request, ['csrf']);
          if (!await auth.callbacks.csrf.verify(request, session, body.csrf!)) throw new WorkspaceError(403, 'CSRF_DENIED');
          return redirect('/workspace', (await auth.callbacks.logout(session, request)).cookie);
        }
        if (url.pathname === '/workspace/save') {
          const body = await parse(request, ['csrf', 'id', 'title', 'body', 'revision', 'published']);
          if (!await auth.callbacks.csrf.verify(request, session, body.csrf!)) throw new WorkspaceError(403, 'CSRF_DENIED');
          const note = notebook.save(body as unknown as Parameters<typeof notebook.save>[0]);
          await cache.delete(cacheKey); protocols.events.publish('note.saved', { id: note.id, revision: note.revision });
          return redirect('/workspace/notes');
        }
        if (url.pathname === '/workspace/analytics/record') {
          const body = await parse(request, ['csrf', 'section', 'duration', 'consent']);
          if (!await auth.callbacks.csrf.verify(request, session, body.csrf!)) throw new WorkspaceError(403, 'CSRF_DENIED');
          if (!['notebook', 'files', 'protocols'].includes(body.section!) || !/^\d{1,5}$/.test(body.duration!) || Number(body.duration) > 60000 || !['granted', 'denied'].includes(body.consent!)) throw new WorkspaceError(400, 'SAMPLE_INVALID');
          const receipt = await analytics.record(body.section!, body.duration!, body.consent!);
          return redirect('/workspace/reports?outcome=' + receipt.outcome);
        }
        if (url.pathname === '/workspace/tags/dispatch') {
          const body = await parse(request, ['csrf', 'consent']);
          if (!await auth.callbacks.csrf.verify(request, session, body.csrf!)) throw new WorkspaceError(403, 'CSRF_DENIED');
          if (!['granted', 'denied'].includes(body.consent!)) throw new WorkspaceError(400, 'CONSENT_INVALID');
          const result = await analytics.tagSample(body.consent as 'granted' | 'denied');
          return html('Local tag result', h('div', null, h('p', null, 'Only the authored local analytics destination can run. This is best-effort collection, not a durable delivery acknowledgement.'), h('pre', null, JSON.stringify(result ?? { outcome: 'consent-denied' }, null, 2))));
        }
        if (url.pathname === '/workspace/assets/upload') {
          const body = await parse(request, ['csrf', 'name', 'content', 'revision']);
          if (!await auth.callbacks.csrf.verify(request, session, body.csrf!)) throw new WorkspaceError(403, 'CSRF_DENIED');
          await assets.upload(body.name!, body.content!, body.revision!, request.signal);
          return redirect('/workspace/assets');
        }
        if (url.pathname === '/workspace/share/create') {
          const body = await parse(request, ['csrf']);
          if (!await auth.callbacks.csrf.verify(request, session, body.csrf!)) throw new WorkspaceError(403, 'CSRF_DENIED');
          const receipt = await links.create(request, { destination: options.origin + '/workspace/public', status: 302, editable: true, revocable: true });
          return html('Short link created', h('div', null, h('p', null, 'This 302 link expires after one day. No click analytics are collected.'), link(receipt.url, receipt.url)));
        }
        if (url.pathname === '/workspace/email/preview') {
          const body = await parse(request, ['csrf', 'title', 'body']);
          if (!await auth.callbacks.csrf.verify(request, session, body.csrf!)) throw new WorkspaceError(403, 'CSRF_DENIED');
          if (body.title!.length > 160 || body.body!.length > 8192) throw new WorkspaceError(400, 'TEMPLATE_INPUT_LIMIT');
          const preview = templates.render('notebook-update', { title: body.title, body: body.body });
          return html('Email composition preview', h('div', null, h('p', null, 'No SMTP connection or delivery was attempted. HTML placeholders are escaped by the email package.'), h('h2', null, preview.subject), h('h3', null, 'Plain text'), h('pre', null, preview.text), h('h3', null, 'Escaped HTML source'), h('pre', null, preview.html)));
        }
        if (url.pathname === '/workspace/experiments/evaluate') {
          const body = await parse(request, ['csrf', 'consent']);
          if (!await auth.callbacks.csrf.verify(request, session, body.csrf!)) throw new WorkspaceError(403, 'CSRF_DENIED');
          if (!['granted', 'denied'].includes(body.consent!)) throw new WorkspaceError(400, 'CONSENT_INVALID');
          if (body.consent === 'denied') return html('Experiment not evaluated', h('p', null, 'You declined. No assignment or analytics record was created.'));
          const result = await evaluator.evaluate('workspace-layout', request, { signal: request.signal });
          return html('Assignment explanation', h('div', null, h('p', null, 'Fixed version 1, three named variants, local environment only. Stateless assignment; no exposure recording or statistical significance claim.'), h('pre', null, JSON.stringify(result, null, 2))));
        }
        if (url.pathname === '/workspace/files/create') {
          const body = await parse(request, ['csrf', 'filename', 'content']);
          if (!await auth.callbacks.csrf.verify(request, session, body.csrf!)) throw new WorkspaceError(403, 'CSRF_DENIED');
          if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.txt$/.test(body.filename!) || body.content!.length > 8192) throw new WorkspaceError(400, 'INVALID_TEXT_FILE');
          await storage.put({ bucket: 'workspace', key: `${dataScope}/${randomUUID()}/${body.filename}` }, Buffer.from(body.content!), { contentType: 'text/plain', visibility: 'private', maxBytes: 32768, ifNoneMatch: true, signal: request.signal });
          return redirect('/workspace/files');
        }
        throw new WorkspaceError(405, 'METHOD_DENIED');
      }
      if (['/workspace/save', '/workspace/files/create', '/workspace/logout', '/workspace/analytics/record', '/workspace/assets/upload', '/workspace/share/create', '/workspace/email/preview', '/workspace/experiments/evaluate', '/workspace/tags/dispatch'].includes(url.pathname)) throw new WorkspaceError(405, 'METHOD_DENIED');
      if (url.pathname === '/workspace/login') {
        const csrf = await formContext(request, null);
        const response = html('Sign in', h('form', { method: 'post', action: '/workspace/login' }, hidden('csrf', csrf.token), field('username', 'Operator username'), field('password', 'Password', '', 'password'), submit('Sign in')));
        if (csrf.cookie) response.headers.set('set-cookie', csrf.cookie); return response;
      }
      if (url.pathname === '/workspace') return html('Local tools, working together', h('div', null, h('p', { class: 'intro' }, 'A ZeruxJS application with ZyroJS UI: write notes, store private objects, search published content and call authenticated protocol APIs. No CMS or external service is required.'), h('div', { class: 'cards' }, [
        ['/workspace/notes', 'Notebook', 'SQLite persistence and optimistic edit conflicts.'], ['/workspace/files', 'Private files', 'Named local object storage with create-only text files.'], ['/workspace/search', 'Local search', 'Unicode-aware, weighted search over explicitly public notes.'], ['/workspace/protocols', 'Protocol lab', 'MCP, JSON-RPC, SSE, Connect JSON/stream and tRPC-style JSON.'],
        ['/workspace/assets', 'Immutable assets', 'Hash-verified binary versions with durable catalog revisions.'],
        ['/workspace/reports', 'Analytics & reports', 'Explicit consent, persisted local samples and accessible report tables.'],
        ['/workspace/tags', 'Controlled tags', 'Trusted collection rules that dispatch only to the local analytics destination.'],
        ['/workspace/share', 'Short links', 'Tenant-owned, expiring 302 links to the public board.'],
        ['/workspace/email', 'Email composition', 'Safe local template previews without connecting to SMTP.'],
        ['/workspace/experiments', 'Experiments', 'Consented deterministic named variants, separate from statistical claims.'],
        ['/workspace/lab', 'Browser library lab', 'Reactive stores, RTL messages, accessibility preferences and generated audio.'],
        ['/workspace/performance', 'Measured responses', 'Bounded compression observations and scoped memory-cache counters.'],
      ].map(([href, title, text]) => h('section', { class: 'card' }, h('h2', null, link(href!, title!)), h('p', null, text)))), link('/workspace/login', 'Sign in to local tools')));
      if (url.pathname === '/workspace/notes') {
        const csrf = await formContext(request, session);
        const notes = notebook.list();
        const editor = (note?: ReturnType<typeof notebook.list>[number]) => h('form', { method: 'post', action: '/workspace/save', class: 'card' }, hidden('csrf', csrf.token), hidden('id', note?.id ?? ''), hidden('revision', String(note?.revision ?? 0)), field('title', 'Title', note?.title ?? ''), h('label', null, 'Text', h('textarea', { name: 'body', maxlength: 8192, rows: 5 }, note?.body ?? '')), h('label', null, 'Visibility', h('select', { name: 'published' }, h('option', { value: 'false', selected: !note?.published }, 'Private'), h('option', { value: 'true', selected: note?.published === true }, 'Public'))), submit(note ? `Save revision ${note.revision + 1}` : 'Create note'));
        const response = html('Notebook', h('div', null, h('p', null, 'Private by default. Public notes appear in search, feeds and the public board. Maximum 100 notes.'), editor(), notes.map(note => editor(note)), h('form', { method: 'post', action: '/workspace/logout' }, hidden('csrf', csrf.token), submit('Sign out'))));
        if (csrf.cookie) response.headers.set('set-cookie', csrf.cookie); return response;
      }
      if (url.pathname === '/workspace/files') {
        const csrf = await formContext(request, session), listing = await storage.list('workspace', { prefix: dataScope + '/', limit: 100 });
        const response = html('Private local objects', h('div', null, h('p', null, 'Local S3-style object addressing, not an AWS wire server. Text objects are private; downloads always check your session.'), h('form', { method: 'post', action: '/workspace/files/create', class: 'card' }, hidden('csrf', csrf.token), field('filename', 'Filename ending in .txt'), h('label', null, 'File contents', h('textarea', { name: 'content', maxlength: 8192, rows: 5 })), submit('Create private object')), h('ul', null, listing.items.map(file => h('li', null, link('/workspace/files/download?key=' + encodeURIComponent(file.key), file.key.split('/').at(-1)! + ` (${file.size} bytes)`)))), listing.nextCursor ? h('p', null, 'Only the first 100 objects are shown.') : null));
        if (csrf.cookie) response.headers.set('set-cookie', csrf.cookie); return response;
      }
      if (url.pathname === '/workspace/files/download') {
        const key = url.searchParams.get('key');
        if (!key || !key.startsWith(dataScope + '/') || url.searchParams.getAll('key').length !== 1) throw new WorkspaceError(403, 'OBJECT_DENIED');
        const bytes = await storage.get({ bucket: 'workspace', key }, 65536);
        return new Response(new Uint8Array(bytes), { headers: { ...headers, 'content-type': 'text/plain; charset=utf-8', 'content-disposition': 'attachment; filename="workspace.txt"' } });
      }
      if (url.pathname === '/workspace/lab') return html('Browser library lab', h('div', null,
        h('p', null, 'The server renders this page with ZyroJS. The browser mounts a separate owned component island: signals, computed values, native controls, scoped preferences and local media playback.'),
        h('p', null, 'The language selector affects this demo only. Preferences are not persisted or sent remotely. Audio starts only when you press Play. INP, remote fonts and unsupported codecs are not simulated.'),
        h('noscript', null, 'Enable JavaScript for the interactive demonstrations. Notebook forms, search, feeds and private downloads continue to work without it.'),
        h('div', { 'data-browser-lab': '', class: 'grid gap-4' })));
      if (url.pathname === '/workspace/reports' || url.pathname === '/workspace/report-data') {
        const aggregate = await analytics.aggregate();
        const chart = { id: 'workspace-events', title: 'Consented local samples', type: 'bar' as const, labels: aggregate.groups.map(group => group.category), values: aggregate.groups.map(group => group.value), total: aggregate.total, sampledRows: 0, truncated: aggregate.truncated, queryMode: 'database' as const, coverage: 'Persisted explicitly consented sample events for this fixed tenant/site. No automatic visitor tracking.' };
        if (url.pathname === '/workspace/report-data') return new Response(JSON.stringify(chart), { headers: { ...headers, 'content-type': 'application/json' } });
        const csrf = await formContext(request, session);
        const outcome = url.searchParams.get('outcome');
        const response = html('Local analytics & reports', h('div', null,
          h('p', null, chart.coverage),
          ['persisted', 'consent-denied', 'unavailable'].includes(outcome ?? '') ? h('p', { role: 'status' }, 'Previous submission: ' + outcome) : null,
          h('form', { method: 'post', action: '/workspace/analytics/record', class: 'card' }, hidden('csrf', csrf.token),
            h('label', null, 'Section', h('select', { name: 'section' }, ['notebook', 'files', 'protocols'].map(section => h('option', { value: section }, section)))),
            field('duration', 'Measured duration in milliseconds (0–60000)', '100', 'number'),
            h('label', null, 'Consent for this sample', h('select', { name: 'consent' }, h('option', { value: 'denied' }, 'Do not collect'), h('option', { value: 'granted' }, 'Collect this sample'))), submit('Submit sample')),
          h('table', null, h('caption', null, 'Exact persisted counts returned by SQLite'), h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Event'), h('th', { scope: 'col' }, 'Count'))), h('tbody', null, aggregate.groups.map(group => h('tr', null, h('th', { scope: 'row' }, group.category), h('td', null, group.value))))),
          aggregate.truncated ? h('p', null, 'Partial result: group limit reached.') : h('p', null, aggregate.total ? 'Returned groups are complete.' : 'No consented samples have been stored.'),
          h('div', { 'data-report-view': '' })));
        if (csrf.cookie) response.headers.set('set-cookie', csrf.cookie); return response;
      }
      if (url.pathname === '/workspace/diagnostics') return html('Generation-owned diagnostics', h('div', null, h('p', null, 'Actual framework lifecycle counts, with no retained headers, request bodies, paths or user traits. Direct handler fixtures do not drive framework lifecycle events.'), h('pre', null, JSON.stringify({ closed, pending: pending.size, lifecycle: lifecycleCounts }, null, 2))));
      if (url.pathname === '/workspace/performance') return html('Response performance lab', h('div', null,
        h('p', null, 'A fixed synthetic approximately 64 KiB JSON response is forwarded by the single zhost compression owner. This page reports observations, not a guaranteed speedup. Private response caching remains disabled. No browser-vitals marketing collection is enabled.'),
        link('/workspace/measure-response', 'Download the repeatable response fixture'),
        h('h2', null, 'Bounded encoder observations'), h('pre', null, JSON.stringify(measurements, null, 2)), h('h2', null, 'Process-local cache counters'), h('pre', null, JSON.stringify(cache.stats(), null, 2))));
      if (url.pathname === '/workspace/tags') {
        const csrf = await formContext(request, session);
        const response = html('Consent-controlled tag collection', h('div', null, h('p', null, 'A trusted, code-registered version-1 container sends an explicitly consented sample to local SQLite analytics. No JavaScript strings, remote destinations or provider credentials are accepted.'), h('pre', null, JSON.stringify(analytics.tagDefinition(), null, 2)), h('form', { method: 'post', action: '/workspace/tags/dispatch' }, hidden('csrf', csrf.token), h('label', null, 'Consent for this sample', h('select', { name: 'consent' }, h('option', { value: 'denied' }, 'Do not dispatch'), h('option', { value: 'granted' }, 'Dispatch locally'))), submit('Evaluate tag'))));
        if (csrf.cookie) response.headers.set('set-cookie', csrf.cookie); return response;
      }
      if (url.pathname === '/workspace/assets') {
        const snapshot = assets.list(), csrf = await formContext(request, session);
        const response = html('Versioned asset catalog', h('div', null, h('p', null, 'Binary storage commits before catalog metadata. Downloads verify SHA-256 before exposing bytes. Concurrent snapshot writes use durable SQLite revisions.'),
          h('form', { method: 'post', action: '/workspace/assets/upload', class: 'card' }, hidden('csrf', csrf.token), hidden('revision', String(snapshot.revision)), field('name', 'Asset name'), h('label', null, 'Text asset contents', h('textarea', { name: 'content', maxlength: 8192 })), submit('Upload immutable text asset')),
          h('ul', null, snapshot.records.map(asset => h('li', null, link('/workspace/assets/download?version=' + asset.versionId, asset.name), ' · immutable version ', asset.versionId))),
          h('p', null, 'Recorded orphan candidates: ' + snapshot.orphans + '. No automatic deletion is performed. Storage failures may require operator inventory reconciliation.')));
        if (csrf.cookie) response.headers.set('set-cookie', csrf.cookie); return response;
      }
      if (url.pathname === '/workspace/assets/download') {
        const version = url.searchParams.get('version');
        if (!version || !/^[a-f0-9]{48}$/.test(version) || url.searchParams.getAll('version').length !== 1) throw new WorkspaceError(400, 'VERSION_INVALID');
        return new Response(new Uint8Array(await assets.download(version, request.signal)), { headers: { ...headers, 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="asset.txt"' } });
      }
      if (url.pathname === '/workspace/share' || url.pathname === '/workspace/email' || url.pathname === '/workspace/experiments') {
        const csrf = await formContext(request, session);
        const contents = url.pathname.endsWith('/share')
          ? h('div', null, h('p', null, 'Create a tenant-owned durable short link to the public board. Destinations are fixed to this site’s public board, never arbitrary URLs. Links use 302 and expire in one day.'), h('form', { method: 'post', action: '/workspace/share/create' }, hidden('csrf', csrf.token), submit('Create short link')))
          : url.pathname.endsWith('/email')
          ? h('div', null, h('p', null, 'Compose an escaped email template locally. Sending, marketing, tracking and inbound mail require an explicitly configured transport and policy; none is enabled here.'), h('form', { method: 'post', action: '/workspace/email/preview' }, hidden('csrf', csrf.token), field('title', 'Subject title'), h('label', null, 'Message', h('textarea', { name: 'body', maxlength: 8192 })), submit('Preview template')))
          : h('div', null, h('p', null, 'Evaluate a fixed three-variant local experiment using the verified operator identity. No client role/subject string is accepted. Assignment is separate from statistical analysis.'), h('form', { method: 'post', action: '/workspace/experiments/evaluate' }, hidden('csrf', csrf.token), h('label', null, 'Consent for assignment', h('select', { name: 'consent' }, h('option', { value: 'denied' }, 'Decline'), h('option', { value: 'granted' }, 'Evaluate locally'))), submit('Evaluate')));
        const response = html('Local application tools', contents); if (csrf.cookie) response.headers.set('set-cookie', csrf.cookie); return response;
      }
      if (url.pathname === '/workspace/protocols') {
        const csrf = await formContext(request, session);
        const response = html('Protocol lab', h('div', null, h('p', null, 'Authenticated read-only notebook summaries. POST requests require this session’s CSRF token, an exact Origin and JSON content type. No content is executed.'), h('label', null, 'CSRF token for protocol requests', h('input', { value: csrf.token, readonly: true })), h('table', null, h('caption', null, 'Implemented zhost endpoints'), h('tbody', null, [
          ['/rpc', 'JSON-RPC 2.0: workspace.summary'], ['/mcp', 'MCP initialization, tools/list, tools/call workspace_summary and resource reads'], ['/events', 'Server-sent note.saved events with bounded backlog'], ['/workspace.Notebook/Summary', 'Connect unary JSON'], ['/workspace.Notebook/SummaryStream', 'Connect framed JSON, at most four input messages'], ['/trpc/workspace.summary', 'tRPC-style JSON subset'],
        ].map(([path, text]) => h('tr', null, h('th', { scope: 'row' }, path), h('td', null, text))))), h('div', { 'data-protocol-client': '' }), h('p', null, 'Native gRPC, HTTP/2 proxying, QUIC/WebTransport and WebSocket upgrades need their hosting adapters; declaring a route does not implement those transports.')));
        if (csrf.cookie) response.headers.set('set-cookie', csrf.cookie); return response;
      }
      const notes = await published();
      if (url.pathname === '/workspace/search' || url.pathname === '/workspace/public') {
        const q = url.searchParams.get('q') ?? '';
        if (q.length > 256 || url.searchParams.getAll('q').length > 1 || [...url.searchParams.keys()].some(key => key !== 'q')) throw new WorkspaceError(400, 'QUERY_INVALID');
        const index = createSearchIndex<{id: string; title: string; text: string}>({ fields: ['title', 'text'], weights: { title: 3 }, maxDocuments: 100, maxQueryLength: 256 });
        index.addMany(notes.map(note => ({ id: note.id, title: note.title, text: note.body })));
        const results = q.trim() ? index.search(q, { limit: 20, prefix: true }).map(result => result.document) : notes.map(note => ({ id: note.id, title: note.title, text: note.body }));
        return html('Published notes', h('div', null, h('form', { method: 'get', action: '/workspace/search', role: 'search' }, field('q', 'Search published notes', q), submit('Search')), h('p', { role: 'status' }, `${results.length} results`), results.map(note => h('article', { id: note.id, class: 'card' }, h('h2', null, note.title), h('p', null, note.text))), link('/workspace/feed.xml', 'RSS'), ' · ', link('/workspace/feed.json', 'JSON Feed')));
      }
      if (url.pathname.endsWith('sitemap.xml')) return new Response(createSitemap(notes.length ? [{ loc: options.origin + '/workspace/public', lastmod: new Date(Math.max(...notes.map(note => note.updatedAt))) }] : []), { headers: { ...headers, 'content-type': 'application/xml' } });
      const format = url.pathname.endsWith('.json') ? 'json' : 'rss';
      const feed = createFeedResponse(format, { title: 'Workspace notes', description: 'Explicitly public notes', siteUrl: options.origin, feedUrl: options.origin + url.pathname, maxItems: 100, maxBytes: 1_048_576, items: notes.map(note => ({ id: options.origin + '/workspace/public#' + note.id, title: note.title, contentText: note.body, url: options.origin + '/workspace/public#' + note.id, date: new Date(note.updatedAt) })) }, 0);
      const etag = '"' + createHash('sha256').update(feed.body).digest('hex') + '"';
      const notModified = request.headers.get('if-none-match')?.split(',').some(value => value.trim().replace(/^W\//, '') === etag || value.trim() === '*');
      return new Response(notModified ? null : feed.body, { status: notModified ? 304 : 200, headers: { ...feed.headers, ...headers, etag } });
    };
    const handle = (request: Request) => {
      if (closed || pending.size >= 16) return Promise.resolve(new Response('Workspace unavailable', { status: 503, headers }));
      const job = run(request).then(response => request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response).catch(error => {
        const status = error instanceof WorkspaceError ? error.status : error instanceof HttpValidationError ? 400 : 503;
        return html(status === 409 ? 'Edit conflict' : 'Request could not complete', h('p', null, status === 409 ? 'Reload the current revision before editing again.' : 'Check your input or sign in again. Private error details are not returned.'), status);
      });
      pending.add(job); void job.finally(() => pending.delete(job)); return job;
    };
    return { handle, close, observeLifecycle(bus: ServerLifecycleHooks | undefined) {
      if (!bus || closed) return;
      for (const phase of ['request:before', 'route:resolved', 'response:before', 'request:error', 'request:after', 'generation:activate'] as const) {
        const token = bus.register(phase, () => { lifecycleCounts[phase] = Math.min((lifecycleCounts[phase] ?? 0) + 1, Number.MAX_SAFE_INTEGER); });
        lifecycleDisposers.push(() => { token.remove(); });
      }
    }, install(api: ZeruxPluginApi) {
      registerFetchRoutes(api, [...paths, '/workspace/s/:slug'].map(path => ({ path, handler: (request, context) => {
        if (context.req.headers.host !== new URL(options.origin).host) return new Response('Access denied', { status: 403, headers });
        return handle(new Request(options.origin + new URL(request.url).pathname + new URL(request.url).search, { method: request.method, headers: request.headers, signal: request.signal, ...(!['GET', 'HEAD'].includes(request.method) ? { body: request.body, duplex: 'half' } : {}) } as RequestInit));
      } })));
      api.addRoute({ pattern: '/workspace/measure-response', method: 'ALL', meta: { streamBody: true }, async handler(context) {
        if (closed || pending.size >= 16) { context.res.writeHead(503); context.res.end(); return; }
        if (!['GET', 'HEAD'].includes(context.method) || context.req.headers.host !== new URL(options.origin).host || !await auth.authenticate(protocolRequest(context.req))) { context.res.writeHead(403, headers); context.res.end('Access denied'); return; }
        const bytes = Buffer.from(JSON.stringify({ fixture: 'Zerux local compression measurement. '.repeat(1800) }));
        const source = Object.assign(Readable.from([bytes]), { statusCode: 200, headers: { ...headers, 'content-type': 'application/json', 'content-length': String(bytes.length) } });
        const job = new Promise<void>((resolve, reject) => {
          const done = () => { context.res.off('finish', done); context.res.off('close', done); resolve(); };
          context.res.once('finish', done); context.res.once('close', done);
          try { forwardPerformanceResponse(compression, context.req, source, context.res, { authenticated: true, public: false }); } catch (error) { source.destroy(); context.res.off('finish', done); context.res.off('close', done); reject(error); }
        });
        pending.add(job); try { await job; } finally { pending.delete(job); }
      } });
      for (const pattern of ['/rpc', '/mcp', '/events', '/workspace.Notebook/Summary', '/workspace.Notebook/SummaryStream', '/trpc/workspace.summary']) api.addRoute({ pattern, method: 'ALL', meta: { streamBody: true }, async handler(context) {
        if (closed) { context.res.statusCode = 503; context.res.end(); return; }
        if (pattern === '/events') {
          const timer = setTimeout(() => context.res.end(), 5000); timer.unref();
          const cleanup = () => { clearTimeout(timer); context.res.off('finish', cleanup); context.res.off('close', cleanup); };
          context.res.once('finish', cleanup); context.res.once('close', cleanup);
        }
        const job = protocols.handle(context.req, context.res); pending.add(job);
        try { await job; } finally { pending.delete(job); }
      } });
    } };
  } catch (error) { await close(); throw error; }
}
