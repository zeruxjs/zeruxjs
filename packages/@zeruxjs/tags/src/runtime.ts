import {
  adminOrigin,
  adminPath,
  adminAsset,
  type TagAdminAuditEvent,
} from './admin-policy.js';
import { importTagDefinition, exportTagDefinition } from './transfer.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { validateTagProviders, inertTagJson } from './providers.js';
import {
  createAnalyticsCollector,
  requestUtcDay,
  reserveNewRequestId,
  validRequestId,
} from '@zeruxjs/analytics';
import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type {
  TagContainer,
  TagEvent,
  TagRuntimeOptions,
  Scalar,
  Values,
  Variable,
  Condition,
  TagDefinition,
  TagContainerStore,
} from './types.js';
import {
  createMemoryTagStore,
  emptyTagContainer,
  validateContainer,
} from './container.js';
import { browserScript } from './browser.js';
import {
  publishedContainer,
  releaseSummary,
  saveTagDraft,
  publishTagDraft,
  rollbackTagRelease,
} from './governance.js';
import { dashboard } from './dashboard.js';

/** Bounded public identifier grammar; no dynamic expression language is supported. */
const nameRe = /^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/;
/** Check named public values before state or dispatch operations.
 * @param {unknown} name - Candidate public identifier checked against the fixed bounded grammar.
 * @returns {boolean} Whether identifier syntax is supported; this does not authenticate it.
 */
const safeName = (name: unknown) =>
  typeof name === 'string' && nameRe.test(name);
/** Serialize fixed private no-store JSON responses; never emit transport causes or credential objects.
 * @param {unknown} body - Fixed host-selected response data without credentials or raw error causes.
 * @param {number} status - Explicit HTTP status, default 200.
 * @returns {Response} Private no-store JSON response with fixed safe protocol headers.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'private, no-store',
      vary: 'Cookie, Authorization',
      'x-content-type-options': 'nosniff',
    },
  });
/** Check an explicit telemetry mount, independent of filesystem and administration asset paths.
 * @param {string} s - Explicit root-relative telemetry mount.
 * @returns {boolean} Whether the path satisfies the supported namespace grammar.
 */
const pathOk = (s: string) =>
  /^\/[A-Za-z0-9/_-]*$/.test(s) &&
  s !== '/' &&
  !s.includes('//') &&
  !s.endsWith('/');
/** Allow bounded finite scalar data, never executable or nested arbitrary values.
 * @param {unknown} v - Candidate public scalar value.
 * @returns {boolean} Whether the value is null, boolean, bounded string or finite number.
 */
const scalar = (v: unknown): v is Scalar =>
  v === null ||
  (typeof v === 'string' && v.length <= 1024) ||
  (typeof v === 'number' && Number.isFinite(v)) ||
  typeof v === 'boolean';
/** Rebuild a bounded null-prototype scalar map and reserve correlation/prototype names.
 * @param {unknown} values - Candidate bounded scalar map; reserved correlation/prototype fields reject.
 * @returns {Values} Fresh validated null-prototype scalar map.
 */
const cleanValues = (values: unknown): Values => {
  if (
    !values ||
    typeof values !== 'object' ||
    Array.isArray(values) ||
    Object.keys(values).length > 40
  ) {
    throw new TypeError('Invalid tag values');
  }
  /** Fresh bounded result metadata or scalar map for this operation, excluding private transport causes. */
  const result: Values = Object.create(null) as Values;
  // Validate every own scalar before exposing a rebuilt map to any destination.
  for (const [k, v] of Object.entries(values)) {
    if (
      !safeName(k) ||
      [
        '__proto__',
        'constructor',
        'prototype',
        'zRequestId',
        'zRequestUtcDay',
      ].includes(k) ||
      !scalar(v)
    ) {
      throw new TypeError('Invalid tag values');
    }
    result[k] = v;
  }
  return result;
};
/** Resolve one declared scalar variable from explicitly supported event/data/context fields. No source module, arbitrary property path or expression is evaluated.
 * @param {Variable} variable - Validated declared variable definition.
 * @param {TagEvent} ev - Bounded event snapshot with host-verified scope.
 * @returns {Scalar | undefined} Literal resolved value or undefined when the selected field is missing.
 */
function resolveVariable(variable: Variable, ev: TagEvent): Scalar | undefined {
  if (variable.type === 'constant') {
    return variable.value;
  }
  if (!variable.key) {
    return undefined;
  }
  if (variable.type === 'event') {
    return ev.properties[variable.key];
  }
  if (variable.type === 'dataLayer') {
    return ev.data?.[variable.key];
  }
  if (variable.type === 'context') {
    /** Explicit scalar context or fresh host audit grant; neither is taken from browser role claims. */
    const context: Record<string, string | undefined> = {
      requestId: ev.requestId,
      requestUtcDay: ev.requestUtcDay,
      source: ev.source,
      site: ev.site,
      pathname: ev.pathname,
      sessionId: ev.sessionId,
      name: ev.name,
    };
    return Object.hasOwn(context, variable.key)
      ? context[variable.key]
      : undefined;
  }
}
/** Resolve only exact registered {{variableId}} bindings; literals remain inert. Missing bound values are omitted, never evaluated as code.
 * @param {TagDefinition} tag - Validated destination/provider tag with bounded scalar parameters.
 * @param {TagEvent} event - Bounded authorized event snapshot.
 * @param {TagContainer} container - Validated containing variable registry.
 * @returns {Values} Fresh null-prototype scalar parameter map.
 */
function tagParameters(
  tag: TagDefinition,
  event: TagEvent,
  container: TagContainer
): Values {
  /** Fresh scalar destination parameters resolved only through declared exact variable bindings. */
  const params: Values = Object.create(null) as Values;
  // Resolve only exact declared bindings; all other accepted values remain scalar literals.
  for (const [key, value] of Object.entries(tag.parameters ?? {})) {
    if (typeof value === 'string') {
      /** Exact variable binding or bounded per-event group matcher; no source string executes. */
      const match = /^\{\{([A-Za-z][A-Za-z0-9_.:-]{0,95})\}\}$/.exec(value);
      if (match) {
        /** Declared variable selected by exact ID from the same validated container. */
        const variable = container.variables.find((v) => v.id === match[1]);
        /** Scalar value from a supported declared variable source; absence remains undefined. */
        const resolved = variable
          ? resolveVariable(variable, event)
          : undefined;
        if (resolved !== undefined) {
          params[key] = resolved;
        }
        continue;
      }
    }
    params[key] = value;
  }
  return params;
}
/** Compare scalar fields using the allowlisted equality/contains/numeric operators. Boolean results are trigger conditions, never permission grants.
 * @param {Condition} condition - Validated scalar comparison definition.
 * @param {TagEvent} ev - Bounded event under evaluation.
 * @param {TagContainer} container - Same validated container used to resolve declared variables.
 * @returns {boolean | undefined} Comparison result; unsupported kinds cannot be introduced through valid container schemas.
 */
function matchesCondition(
  condition: Condition,
  ev: TagEvent,
  container: TagContainer
) {
  /** Declared condition variable, if present in this same validated container. */
  const v = container.variables.find((x) => x.id === condition.field);
  /** Resolved scalar condition operand; no deep arbitrary property traversal occurs. */
  const actual = v
    ? resolveVariable(v, ev)
    : (ev.properties[condition.field] ?? ev.data?.[condition.field]);
  /** Declared scalar comparison operand; never a regex or code expression. */
  const expected = condition.value;
  switch (condition.operator) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'contains':
      return (
        typeof actual === 'string' &&
        typeof expected === 'string' &&
        actual.includes(expected)
      );
    case 'gte':
      return (
        typeof actual === 'number' &&
        typeof expected === 'number' &&
        actual >= expected
      );
    case 'lte':
      return (
        typeof actual === 'number' &&
        typeof expected === 'number' &&
        actual <= expected
      );
  }
}
/** Create an app-scoped server tag runtime over borrowed analytics, request-ID and document stores. Explicitly owned providers dispose only after actual admin/dispatch drain; construction starts no listener.
 * @param {TagRuntimeOptions} options - Private host policy, fresh authorization/consent, explicit destinations and optional provider registry.
 * @returns {object} Owned runtime and inert route declarations; host mounts routes and must await close before releasing dependencies.
 */
export function createTagManager(options: TagRuntimeOptions) {
  if (
    typeof options?.analytics?.track !== 'function' ||
    typeof options?.requestIds?.reserve !== 'function'
  ) {
    throw new TypeError('Analytics and request ID store are required');
  }

  if (
    options.site !== undefined &&
    (typeof options.site !== 'string' ||
      !options.site ||
      options.site.length > 200 ||
      // eslint-disable-next-line no-control-regex -- Reject control characters; this existing validation range is intentional.
      /[\x00-\x1f]/.test(options.site))
  ) {
    throw new TypeError('Invalid fixed tag site');
  }
  if (
    options.providers &&
    ['validate', 'dispatch', 'allowsDestination', 'configured', 'close'].some(
      (k) =>
        typeof (options.providers as unknown as Record<string, unknown>)[k] !==
        'function'
    )
  ) {
    throw new TypeError('Invalid explicit provider registry');
  }
  /** Validated telemetry mount, default /_tags, separate from admin API/UI paths. */
  const prefix = options.prefix ?? '/_tags';
  if (!pathOk(prefix)) {
    throw new TypeError('Invalid tag endpoint path');
  }
  if (
    options.dashboardHost &&
    !/^[A-Za-z0-9.-]+(?::\d{2,5})?$/.test(options.dashboardHost)
  ) {
    throw new TypeError('Invalid tag dashboard host');
  }
  if (options.publicOrigin) {
    /** Explicit host-configured public/provider URL; untrusted saved definitions never select arbitrary endpoints. */
    const url = new URL(options.publicOrigin);
    if (
      (url.protocol !== 'https:' &&
        !(
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(url.hostname)
        )) ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      throw new TypeError('Invalid public tagging origin');
    }
  }
  if (
    (options.defaultConsent !== undefined &&
      !['granted', 'denied'].includes(options.defaultConsent)) ||
    (options.requireBrowserConsent !== undefined &&
      typeof options.requireBrowserConsent !== 'boolean') ||
    (options.maxBodyBytes !== undefined &&
      (!Number.isSafeInteger(options.maxBodyBytes) ||
        options.maxBodyBytes < 256 ||
        options.maxBodyBytes > 262144))
  ) {
    throw new TypeError('Invalid consent/body policy');
  }
  /** Maximum actual pending dispatches, default eight; timeouts do not free unsettled slots. */
  const maxPending = options.maxConcurrentDispatches ?? 8;
  /** Dispatch observation deadline, default 2000 ms; cancellation remains cooperative. */
  const dispatchTimeout = options.dispatchTimeoutMs ?? 2000;
  if (
    !Number.isSafeInteger(maxPending) ||
    maxPending < 1 ||
    maxPending > 64 ||
    !Number.isSafeInteger(dispatchTimeout) ||
    dispatchTimeout < 1 ||
    dispatchTimeout > 30000 ||
    (options.ownProviders !== undefined &&
      typeof options.ownProviders !== 'boolean') ||
    (options.allowDispatch !== undefined &&
      typeof options.allowDispatch !== 'function')
  ) {
    throw new TypeError('Invalid dispatch policy');
  }
  /** App-scoped async context rejects provider reentry into the same manager. */
  const dispatchContext = new AsyncLocalStorage<boolean>();
  /** Actual dispatch promises retained until settlement independently of caller deadlines. */
  const jobs = new Set<Promise<unknown>>();
  /** Owned cooperative dispatch controllers aborted before shutdown drain. */
  const controllers = new Set<AbortController>();
  let closed = false,
    closing: Promise<void> | undefined;
  /** Explicit host administration policy; asset and API paths remain independent. */
  const mount = options.administration ?? {};
  /** Actual administration concurrency ceiling, default eight, maximum sixty-four. */
  const adminMax = mount.maxConcurrent ?? 8;
  if (!Number.isSafeInteger(adminMax) || adminMax < 1 || adminMax > 64) {
    throw new RangeError('Invalid admin concurrency');
  }
  /** Validated admin API prefix, default telemetry prefix plus /admin. */
  const adminBase = adminPath(mount.basePath ?? prefix + '/admin');
  /** Independent authenticated HTML mount; no implicit asset server is started. */
  const uiPath = adminPath(mount.uiPath ?? adminBase);
  /** Optional exact API origin used for explicit UI requests, never forwarded-header inference. */
  const publicAdminOrigin =
    mount.publicOrigin !== undefined
      ? adminOrigin(mount.publicOrigin)
      : undefined;
  if (
    (mount.serveUi !== undefined && typeof mount.serveUi !== 'boolean') ||
    (mount.allowedOrigins !== undefined &&
      (!Array.isArray(mount.allowedOrigins) ||
        mount.allowedOrigins.length > 16)) ||
    (mount.verifyCsrf !== undefined &&
      typeof mount.verifyCsrf !== 'function') ||
    (mount.issueCsrfToken !== undefined &&
      typeof mount.issueCsrfToken !== 'function') ||
    Boolean(mount.audit) !== Boolean(mount.auditContext) ||
    (mount.audit !== undefined && typeof mount.audit !== 'function') ||
    (mount.auditContext !== undefined &&
      typeof mount.auditContext !== 'function')
  ) {
    throw new TypeError('Invalid admin mount policy');
  }
  if (mount.issueCsrfToken && !mount.verifyCsrf) {
    throw new TypeError('CSRF token issuance requires a verifier');
  }
  /** Exact credentialed UI origin allowlist; cross-origin configuration requires CSRF verification. */
  const adminOrigins = new Set((mount.allowedOrigins ?? []).map(adminOrigin));
  if (adminOrigins.size && !mount.verifyCsrf) {
    throw new TypeError('Cross-origin admin requires a host CSRF verifier');
  }
  /** Optional validated host-served stylesheet URL; library does not copy or build it. */
  const styleHref =
    mount.styleHref !== undefined ? adminAsset(mount.styleHref) : undefined;
  /** Optional validated host module replacing built-in UI script; host owns serving/CORS. */
  const scriptSrc =
    mount.scriptSrc !== undefined ? adminAsset(mount.scriptSrc) : undefined;
  /** Complete candidate route paths checked for collisions before any registration. */
  const mountPaths = [
    ...(mount.serveUi === false ? [] : [uiPath]),
    ...[
      'api',
      'validate',
      'preview',
      'import',
      'export',
      'status',
      'publish',
      'rollback',
    ].map((name) => adminBase + '/' + name),
    prefix + '/collect',
    prefix + '/ttag.js',
  ];
  if (new Set(mountPaths).size !== mountPaths.length) {
    throw new TypeError('Conflicting admin mount paths');
  }
  /** Explicit API location supplied to the authenticated UI independently of assets. */
  const apiUrl = (publicAdminOrigin ?? '') + adminBase;
  /** Actual protected admin promises retained through audit/store settlement for close. */
  const adminJobs = new Set<Promise<Response>>();
  /** Borrowed atomic document store or explicit volatile development fallback. */
  const store: TagContainerStore =
    options.store ??
    createMemoryTagStore(options.container ?? emptyTagContainer());
  /** Borrowed configured Fetch transport; manager close never closes global pools. */
  const http = options.fetch ?? fetch;
  /** Isolated fixed diagnostic sink; transport causes, URLs and event payloads are excluded.
   * @param {string} message - Fixed diagnostic text containing no private transport cause or event body.
   * @returns {void} Completes even if the optional host warning sink throws.
   */
  const warn = (message: string) => {
    try {
      (options.onWarning ?? console.warn)(`[zerux tags] ${message}`);
    } catch {
      /* telemetry warnings cannot block traffic */
    }
  };
  /** Independent host origin-to-site binding snapshot; browser site claims remain untrusted. */
  const siteByOrigin = structuredClone(options.siteByOrigin ?? {});
  /** Private cloned destination reference map with host-reviewed egress policy. */
  const configuredDestinations: NonNullable<TagRuntimeOptions['destinations']> =
    Object.assign(
      Object.create(null),
      structuredClone(options.destinations ?? {})
    );
  /** Private cloned credential-reference map; secrets never enter public definitions/bootstrap. */
  const credentials: NonNullable<TagRuntimeOptions['credentials']> =
    Object.assign(
      Object.create(null),
      structuredClone(options.credentials ?? {})
    );
  // Validate all configured endpoints before returning routes or permitting dispatch.
  for (const destination of Object.values(configuredDestinations)) {
    /** Explicit host-configured public/provider URL; untrusted saved definitions never select arbitrary endpoints. */
    const url = new URL(destination.url);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      !url.hostname ||
      isIP(url.hostname) !== 0 ||
      url.hostname.startsWith('[') ||
      /^(localhost|.+\.(?:localhost|local|internal))\.?$/i.test(url.hostname)
    ) {
      throw new TypeError(
        'Webhook destinations must be public HTTPS DNS endpoints'
      );
    }
  }
  /** Match supported authored event kinds; no callbacks or regex from saved definitions.
   * @param {string} type - Validated declared trigger kind.
   * @param {string} name - Bounded event identifier under evaluation.
   * @param {string} eventName - Optional exact event identifier for event triggers.
   * @returns {boolean} Whether the fixed kind/event comparison matches.
   */
  const triggerMatches = (type: string, name: string, eventName?: string) =>
    type === 'all' ||
    (type === 'event' && eventName === name) ||
    (type === 'pageview' && ['page_view', 'page.view'].includes(name)) ||
    (type === 'click' && name === 'click') ||
    (type === 'form' && name === 'form_submit') ||
    (type === 'history' && name === 'history_change');
  /** Evaluate a bounded Boolean trigger graph deterministically for one event, memoizing only within that evaluation.
   * @param {TagContainer} container - Validated trigger definitions with acyclic bounded references.
   * @param {TagEvent} event - Bounded event under the initiating tenant/site policy.
   * @returns {Trigger[]} Matched declared triggers in container order; no destination dispatch occurs.
   */
  function matchedTriggers(container: TagContainer, event: TagEvent) {
    /** Per-event Boolean group memoization only; no cross-tenant/event result reuse. */
    const cache = new Map<string, boolean>();
    let work = 0;
    /** Exact variable binding or bounded per-event group matcher; no source string executes.
     * @param {string} id - Declared trigger identifier from the same validated container.
     * @param {number} depth - Current graph ancestor depth, default zero.
     * @returns {boolean} Bounded per-event Boolean result; no authorization grant.
     */
    const match = (id: string, depth = 0): boolean => {
      if (++work > 5000 || depth > 8) {
        throw new RangeError('Trigger evaluation limit');
      }
      if (cache.has(id)) {
        return cache.get(id)!;
      }
      /** Exact declared trigger selected for this bounded event graph. */
      const t = container.triggers.find((t) => t.id === id);
      if (!t || t.enabled === false) {
        return false;
      }
      let matched = false;
      if (t.type === 'group') {
        /** Bounded Boolean group inputs or rebuilt scalar destination values, never source expressions. */
        const values = t.composition!.triggerIds.map((id) =>
          match(id, depth + 1)
        );
        if (t.composition!.mode === 'all') {
          matched = values.every(Boolean);
        } else if (t.composition!.mode === 'any') {
          matched = values.some(Boolean);
        } else {
          matched = !values[0];
        }
      } else {
        matched = triggerMatches(t.type, event.name, t.event);
      }
      matched =
        matched &&
        (t.conditions ?? []).every((c) =>
          matchesCondition(c, event, container)
        );
      cache.set(id, matched);
      return matched;
    };
    return container.triggers.filter((t) => match(t.id));
  }
  /** Load the published snapshot and isolate each permitted destination outcome. Recheck fresh consent before later tags/sends; already-started external effects cannot be recalled.
   * @param {TagEvent} event - Independent bounded event snapshot; identity consent is host-owned.
   * @param {() => boolean} consented - Fresh mutable request-scope consent check, not a browser role claim.
   * @param {AbortSignal} signal - Borrowed cooperative operation signal retained until actual settlement.
   * @returns {Promise<object>} Fixed correlation and tag/trigger outcome IDs; HTTP acceptance is not remote processing proof.
   */
  async function runEvaluation(
    event: TagEvent,
    consented: () => boolean,
    signal: AbortSignal
  ) {
    let container: TagContainer;
    try {
      container = publishedContainer(await store.load());
      validateTagProviders(container, options.providers);
    } catch {
      warn('Published container unavailable');
      return {
        requestId: event.requestId,
        requestUtcDay: event.requestUtcDay,
        matchedTriggers: [],
        firedTags: [],
        failures: ['container_unavailable'],
      };
    }
    /** Declared matching triggers under the current consent/scope policy. */
    const matched = matchedTriggers(container, event);
    /** Per-evaluation matched trigger ID set, preserving declared order. */
    const ids = new Set(matched.map((t) => t.id));
    /** Fixed destination IDs whose native dispatch settled successfully, not remote-processing proof. */
    const firedTags: string[] = [];
    /** Fixed failed tag IDs or runtime outcome categories; private causes are not exposed. */
    const failures: string[] = [];
    // Keep declared order and recheck consent before each independently isolated destination.
    for (const tag of container.tags) {
      if (tag.enabled === false || !tag.triggerIds.some((id) => ids.has(id))) {
        continue;
      }
      try {
        if (signal.aborted || !consented()) {
          break;
        }
        if (
          options.allowDispatch &&
          (await options.allowDispatch(
            Object.freeze(structuredClone(event))
          )) !== true
        ) {
          continue;
        }
        if (signal.aborted || !consented()) {
          break;
        }
        /** Fresh scalar destination parameters resolved only through declared exact variable bindings. */
        const params = tagParameters(tag, event, container);
        if (tag.type === 'analytics') {
          await options.analytics.track({
            name: tag.eventName ?? event.name,
            source: event.source,
            site: event.site,
            pathname: event.pathname,
            sessionId: event.sessionId,
            requestId: event.requestId,
            requestUtcDay: event.requestUtcDay,
            properties: { ...event.properties, ...params },
          });
        } else if (tag.type === 'ga4') {
          /** Private server-only GA4 credential resolved from an explicit host reference. */
          const secret = credentials[tag.credentialRef ?? '']?.secret;
          if (!secret) {
            throw new Error('Missing GA4 credential');
          }
          /** Declared variable selected by exact ID from the same validated container. */
          const variable = container.variables.find(
            (v) => v.id === tag.clientIdVariable
          );
          /** Explicit consented GA4 identifier from context/declared variable; never fingerprinted. */
          const clientId = variable
            ? resolveVariable(variable, event)
            : event.sessionId;
          if (
            typeof clientId !== 'string' ||
            !clientId ||
            clientId.length > 128
          ) {
            throw new Error('GA4 client_id must be supplied explicitly');
          }
          /** Explicit host-configured public/provider URL; untrusted saved definitions never select arbitrary endpoints. */
          const url = new URL('https://www.google-analytics.com/mp/collect');
          url.searchParams.set('measurement_id', tag.measurementId!);
          url.searchParams.set('api_secret', secret);
          /** Native Fetch response with body cancellation after bounded status inspection, or fixed private HTTP result. */
          const response = await http(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              client_id: clientId,
              events: [
                {
                  name: tag.eventName ?? event.name,
                  params: {
                    ...event.properties,
                    ...params,
                    zerux_request_id: event.requestId,
                  },
                },
              ],
            }),
            signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]),
            redirect: 'error',
          });
          try {
            if (!response.ok) {
              throw new Error('GA4 endpoint rejected request');
            }
          } finally {
            await response.body?.cancel().catch(() => {});
          }
        } else if (tag.type === 'provider') {
          let sends = 0;
          /** Actual bounded provider sends retained even when trusted code forgets to await them. */
          const sendJobs: Promise<void>[] = [];
          let providerDone = false;
          /** Scope-bound allowlisted destination sender; rejects after provider completion and caps sends.
           * @param {string} ref - Opaque destination reference declared by both provider and host.
           * @param {Values} payload - Bounded public scalar payload validated before an outbound request.
           * @returns {Promise<void>} Actual native send settlement; detached calls remain tracked by the manager.
           */
          const send = (ref: string, payload: Values) => {
            if (providerDone) {
              throw new Error('Provider scope closed');
            }
            if (
              ++sends > 4 ||
              !options.providers!.allowsDestination(tag, ref)
            ) {
              throw new Error('Provider destination budget denied');
            }
            /** Actual provider network operation retained and drained before releasing dispatch capacity. */
            const task = (async () => {
              if (
                signal.aborted ||
                !consented() ||
                (options.allowDispatch &&
                  (await options.allowDispatch(
                    Object.freeze(structuredClone(event))
                  )) !== true)
              ) {
                throw new Error('Dispatch denied');
              }
              if (signal.aborted || !consented()) {
                throw new Error('Dispatch denied');
              }
              /** Bounded Boolean group inputs or rebuilt scalar destination values, never source expressions. */
              const values = cleanValues(payload);
              /** Private configured HTTPS destination selected only through an allowlisted reference. */
              const destination = configuredDestinations[ref];
              if (!destination) {
                throw new Error('Unapproved destination');
              }
              /** Bounded serialized scalar outbound payload; no arbitrary executable body is interpreted. */
              const body = JSON.stringify(values);
              if (Buffer.byteLength(body) > 16384) {
                throw new RangeError('Provider event size');
              }
              /** Native Fetch response with body cancellation after bounded status inspection, or fixed private HTTP result. */
              const response = await http(destination.url, {
                method: 'POST',
                headers: {
                  ...destination.headers,
                  'content-type': 'application/json',
                },
                body,
                signal,
                redirect: 'error',
              });
              try {
                if (!response.ok) {
                  throw new Error('Destination rejected');
                }
              } finally {
                await response.body?.cancel().catch(() => {});
              }
            })();
            sendJobs.push(task);
            void task.catch(() => {});
            return task;
          };
          try {
            await options.providers!.dispatch(tag, {
              event: Object.freeze({
                ...event,
                properties: Object.freeze({ ...event.properties }),
                data: Object.freeze({ ...event.data }),
              }),
              config: Object.freeze({ ...tag.publicConfig }),
              parameters: Object.freeze({ ...params }),
              signal,
              send,
            });
          } finally {
            providerDone = true;
            await Promise.allSettled(sendJobs);
          }
          await Promise.all(sendJobs);
        } else {
          /** Private configured HTTPS destination selected only through an allowlisted reference. */
          const destination = configuredDestinations[tag.destinationRef ?? ''];
          if (!destination) {
            throw new Error('Missing allowlisted destination');
          }
          /** Native Fetch response with body cancellation after bounded status inspection, or fixed private HTTP result. */
          const response = await http(destination.url, {
            method: 'POST',
            headers: {
              ...destination.headers,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              event: tag.eventName ?? event.name,
              requestId: event.requestId,
              utcDay: event.requestUtcDay,
              site: event.site,
              properties: event.properties,
              parameters: params,
            }),
            signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]),
            redirect: 'error',
          });
          try {
            if (!response.ok) {
              throw new Error('Destination rejected request');
            }
          } finally {
            await response.body?.cancel().catch(() => {});
          }
        }
        firedTags.push(tag.id);
      } catch {
        failures.push(tag.id);
        warn(`Destination failed for tag ${tag.id}`);
      } // Tags are isolated, never block other tags.
    }
    /** Fresh bounded result metadata or scalar map for this operation, excluding private transport causes. */
    const result = {
      requestId: event.requestId,
      requestUtcDay: event.requestUtcDay,
      matchedTriggers: [...ids],
      firedTags,
      failures,
    };
    if (options.debug) {
      try {
        options.onDebug?.({
          requestId: event.requestId,
          event: event.name,
          matchedTriggers: result.matchedTriggers,
          firedTags,
          failures,
        });
      } catch {
        /* This optional failure is intentionally ignored. */
      }
    }
    return result;
  }
  /** Bound pending work and reject reentrant dispatch without replay. Caller deadlines stop waiting but retain the native job and capacity until actual settlement.
   * @param {TagEvent} event - Trusted server event with already reserved request ID; remote callers must use the collector.
   * @param {() => boolean} consented - Optional fresh consent check; default follows the configured telemetry consent policy.
   * @returns {Promise<object>} Fixed dispatch result, overload/cancellation/unavailable outcome; not durable queue acknowledgement.
   */
  async function evaluate(
    event: TagEvent,
    consented: () => boolean = () => options.defaultConsent !== 'denied'
  ) {
    /** Construct a fixed fail-soft dispatch outcome without raw event bodies or private causes.
     * @param {string} reason - Fixed fail-soft runtime outcome category.
     * @returns {object} Correlation IDs and fixed failure label without private content.
     */
    const failed = (reason: string) => ({
      requestId: event?.requestId ?? '',
      requestUtcDay: event?.requestUtcDay ?? '',
      matchedTriggers: [] as string[],
      firedTags: [] as string[],
      failures: [reason],
    });
    if (closed) {
      return failed('closed');
    }
    if (dispatchContext.getStore()) {
      return failed('recursive_dispatch');
    }
    if (jobs.size >= maxPending) {
      return failed('dispatch_overload');
    }
    inertTagJson(event, options.maxBodyBytes ?? 16384);
    if (
      !event ||
      Object.keys(event).some(
        (k) =>
          ![
            'name',
            'properties',
            'site',
            'pathname',
            'sessionId',
            'requestId',
            'requestUtcDay',
            'source',
            'data',
          ].includes(k)
      ) ||
      !safeName(event.name) ||
      !validRequestId(event.requestId) ||
      !/^\d{4}-\d\d-\d\d$/.test(event.requestUtcDay) ||
      !['web', 'server'].includes(event.source) ||
      (options.site !== undefined &&
        event.site !== undefined &&
        event.site !== options.site &&
        !(
          event.source === 'web' &&
          Object.values(siteByOrigin).includes(event.site)
        ))
    ) {
      throw new TypeError('Invalid event scope');
    }

    if (
      (event.site !== undefined &&
        (typeof event.site !== 'string' ||
          !event.site ||
          event.site.length > 200 ||
          // eslint-disable-next-line no-control-regex -- Reject control characters; this existing validation range is intentional.
          /[\x00-\x1f]/.test(event.site))) ||
      (event.pathname !== undefined &&
        (typeof event.pathname !== 'string' || event.pathname.length > 2000)) ||
      (event.sessionId !== undefined &&
        (typeof event.sessionId !== 'string' || event.sessionId.length > 200))
    ) {
      throw new TypeError('Invalid event context');
    }
    event = {
      ...event,
      pathname: event.pathname?.split(/[?#]/)[0],
      site: event.site ?? options.site,
      properties: cleanValues(event.properties),
      data: cleanValues(event.data ?? {}),
    };
    if (!consented()) {
      return failed('consent_denied');
    }
    /** Owned cooperative controller retained with actual native dispatch work. */
    const controller = new AbortController();
    controllers.add(controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop = () => {};
    /** Caller-observation outcome separate from actual native settlement and shutdown ownership. */
    const cancelled = new Promise<ReturnType<typeof failed>>((resolve) => {
      stop = () => resolve(failed('dispatch_cancelled'));
      controller.signal.addEventListener('abort', stop, { once: true });
      timer = setTimeout(() => controller.abort(), dispatchTimeout);
    });
    /** Actual dispatch promise retained until settlement; timeout never auto-replays it. */
    const native = dispatchContext
      .run(true, () => runEvaluation(event, consented, controller.signal))
      .catch(() => failed('dispatch_unavailable'))
      .finally(() => {
        jobs.delete(native);
        controllers.delete(controller);
      });
    jobs.add(native);
    try {
      return await Promise.race([native, cancelled]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      controller.signal.removeEventListener('abort', stop);
    }
  }
  /** Create mutable request-local server tagging state over verified host context. Never share this closure across users; one request ID may correlate related events.
   * @param {{requestId?:string;requestUtcDay?:string;site?:string;pathname?:string;sessionId?:string}} context - Optional trusted initiating request scope; fixed site cannot be overridden.
   * @param {string} context.requestId - Optional already selected opaque ID that still requires reservation.
   * @param {string} context.requestUtcDay - Explicit trusted UTC reservation day, default current server day.
   * @param {string} context.site - Trusted site context; fixed manager sites cannot be overridden.
   * @param {string} context.pathname - Optional route path; query/fragment are removed at dispatch.
   * @param {string} context.sessionId - Optional explicitly consented opaque identity.
   * @returns {Function} Request-local event/config/set/get/consent API; no production identity is inferred.
   */
  function createAstag(
    context: {
      requestId?: string;
      requestUtcDay?: string;
      site?: string;
      pathname?: string;
      sessionId?: string;
    } = {}
  ) {
    if (closed) {
      throw new Error('Tag manager closed');
    }
    if (
      options.site !== undefined &&
      context.site !== undefined &&
      context.site !== options.site
    ) {
      throw new TypeError('Fixed tag site mismatch');
    }
    /** Request-local bounded mutable scalar data layer; never shared across user requests. */
    const layer: Values = Object.create(null) as Values;
    /** Request-local trusted site/path/session configuration; fixed manager sites remain authoritative. */
    const conf: {
      site?: string;
      pathname?: string;
      sessionId?: string;
      debug?: boolean;
    } = {
      site: context.site ?? options.site,
      pathname: context.pathname,
      sessionId: context.sessionId,
    };
    let consent: 'granted' | 'denied' = options.defaultConsent ?? 'granted';
    /** Trusted request UTC reservation day, default current server day. */
    const reservedDay = context.requestUtcDay ?? requestUtcDay();
    let allocated: Promise<string> | undefined;
    /** Lazily reserve one request-scoped ID in the supplied UTC-day store. A supplied ID must still win atomic reservation; unknown failures never become successful telemetry.
     * @returns {Promise<string>} Reserved opaque ID; failure propagates to the fail-soft caller outcome.
     */
    async function ensureId() {
      if (!allocated) {
        /** Captured reservation day for the one request-scoped allocation attempt. */
        const day = reservedDay;
        allocated = (async () => {
          if (context.requestId) {
            if (!validRequestId(context.requestId)) {
              throw new TypeError('Invalid request ID');
            }
            if (!(await options.requestIds.reserve(day, context.requestId))) {
              throw new Error('Duplicate request ID');
            }
            return context.requestId;
          }
          return reserveNewRequestId(options.requestIds, day);
        })();
      }
      return allocated;
    }
    return async function astag(
      command: 'event' | 'config' | 'set' | 'get' | 'consent',
      arg?: string | Record<string, unknown>,
      value?: unknown
    ): Promise<unknown> {
      if (command === 'set') {
        if (
          typeof arg !== 'string' ||
          !safeName(arg) ||
          [
            '__proto__',
            'constructor',
            'prototype',
            'zRequestId',
            'zRequestUtcDay',
          ].includes(arg) ||
          !scalar(value) ||
          (!Object.hasOwn(layer, arg) && Object.keys(layer).length >= 40)
        ) {
          throw new TypeError('Invalid data-layer value');
        }
        layer[arg] = value;
        return true;
      }
      if (command === 'get') {
        return typeof arg === 'string'
          ? (layer[arg] ??
              (Object.hasOwn(conf, arg)
                ? (conf as Record<string, unknown>)[arg]
                : undefined))
          : undefined;
      }
      if (command === 'config') {
        if (typeof arg !== 'object' || arg === null) {
          throw new TypeError('Config must be an object');
        }
        if (
          options.site !== undefined &&
          arg.site !== undefined &&
          arg.site !== options.site
        ) {
          throw new TypeError('Fixed tag site mismatch');
        }
        // Copy only supported request-local scalar configuration, never another fixed site.
        for (const [key, item] of Object.entries(arg)) {
          if (
            ['site', 'pathname', 'sessionId'].includes(key) &&
            typeof item === 'string' &&
            item.length <= 200
          ) {
            (conf as Record<string, unknown>)[key] = item;
          }
        }
        return true;
      }
      if (command === 'consent') {
        if (arg !== 'granted' && arg !== 'denied') {
          throw new TypeError('Invalid telemetry consent state');
        }
        consent = arg;
        return true;
      }
      if (command !== 'event' || typeof arg !== 'string' || !safeName(arg)) {
        throw new TypeError('Invalid tag operation');
      }
      if (consent === 'denied') {
        return undefined;
      }
      /** Validated bounded scalar event properties captured before request-ID reservation. */
      const properties = cleanValues(value ?? {});
      let id: string;
      try {
        id = await ensureId();
      } catch {
        allocated = undefined;
        warn('Request ID reservation unavailable');
        return {
          requestId: '',
          requestUtcDay: reservedDay,
          matchedTriggers: [],
          firedTags: [],
          failures: ['request_id_unavailable'],
        };
      }
      return evaluate(
        {
          name: arg,
          properties,
          source: 'server',
          requestId: id,
          requestUtcDay: reservedDay,
          site: conf.site,
          pathname: conf.pathname,
          sessionId: conf.sessionId,
          data: { ...layer },
        },
        () => consent === 'granted'
      );
    };
  }
  /** Borrowed-analytics collection boundary enforcing origin/site/consent and atomic request-ID reservation. */
  const collector = createAnalyticsCollector({
    analytics: options.analytics,
    prefix,
    allowedOrigins: options.allowedOrigins,
    serverToken: options.serverToken,
    requestIdStore: options.requestIds,
    requireRequestId: true,
    siteByOrigin,
    requireBrowserConsent:
      options.requireBrowserConsent ?? options.defaultConsent === 'denied',
    botPolicy: options.botPolicy,
    maxBodyBytes: options.maxBodyBytes ?? 16_384,
    maxEventsPerMinute: options.maxEventsPerMinute ?? 120,
    allowTextPlainBeacon: true,
    dispatch: async (input, ctx) => {
      if (!safeName(input.name)) {
        return;
      }
      /** Rebuilt bounded collected scalar properties before server evaluation. */
      const props = cleanValues(input.properties ?? {});
      /** Rebuilt bounded collected data-layer values before server evaluation. */
      const data = cleanValues(input.data ?? {});
      await evaluate(
        {
          name: input.name,
          properties: props,
          data,
          site: input.site ?? options.site,
          pathname: input.pathname,
          sessionId: input.sessionId,
          source: 'web',
          requestId: ctx.requestId,
          requestUtcDay: ctx.utcDay,
        },
        () => true
      );
    },
  });
  /** Explicit public telemetry collection URL; no secrets or provider endpoints enter bootstrap. */
  const endpoint = options.publicOrigin
    ? new URL(prefix + '/collect', options.publicOrigin).href
    : prefix + '/collect';
  /** Public bootstrap handler loads only published automatic trigger kinds.
   * @param {Request} _request - Borrowed public request; identity never changes bootstrap configuration.
   * @returns {Promise<Response>} Published-trigger bootstrap or fixed closed response, without provider credentials.
   */
  const scriptHandler = async (_request: Request) => {
    if (closed) {
      return json({ error: 'Closed' }, 503);
    }
    let activeTypes: string[] = [];
    try {
      /** Validated draft or published definition; preview selection never mutates or dispatches it. */
      const container = publishedContainer(await store.load());
      activeTypes = [
        ...new Set(
          container.triggers
            .filter((t) => t.enabled !== false)
            .map((t) => t.type)
        ),
      ];
    } catch {
      /* This optional failure is intentionally ignored. */
    }
    /** Self-contained bootstrap with script-safe explicit public settings only. */
    const js = browserScript({
      endpoint,
      site: options.site ?? '',
      debug: options.debug === true,
      autoEvents: activeTypes,
      defaultConsent: options.defaultConsent ?? 'granted',
    });
    return new Response(js, {
      headers: {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'cross-origin-resource-policy': 'cross-origin',
      },
    });
  };
  /** Fresh host admin authorization plus optional exact API request host restriction.
   * @param {Request} request - Borrowed request passed to fresh trusted host session/tenant authorization.
   * @returns {Promise<boolean>} Literal true only after configured host and permission checks; errors deny.
   */
  const authorized = async (request: Request) => {
    if (closed) {
      return false;
    }
    if (
      options.dashboardHost &&
      new URL(request.url).host !== options.dashboardHost
    ) {
      return false;
    }
    if (!options.authorizeAdmin) {
      return false;
    }
    try {
      return (await options.authorizeAdmin(request)) === true;
    } catch {
      return false;
    }
  };
  /** Separate publisher permission layered over fresh editor/admin authorization.
   * @param {Request} request - Borrowed request requiring both editor/admin and independent publisher grants.
   * @returns {Promise<boolean>} Whether both fresh trusted checks permit the transition.
   */
  const canPublish = async (request: Request) => {
    if (!(await authorized(request)) || !options.authorizePublish) {
      return false;
    }
    try {
      return (await options.authorizePublish(request)) === true;
    } catch {
      return false;
    }
  };
  /** Exact Origin and optional session-CSRF verifier for all protected state-changing operations.
   * @param {Request} request - Borrowed protected write request with exact Origin and optional session-CSRF token.
   * @returns {Promise<boolean>} Whether the exact origin plus configured host verifier accepts; not a replacement for authorization.
   */
  const sameOrigin = async (request: Request) => {
    /** Raw request Origin compared only to exact configured/same-origin policy. */
    const origin = request.headers.get('origin');
    if (
      !origin ||
      (origin !== new URL(request.url).origin && !adminOrigins.has(origin))
    ) {
      return false;
    }
    if (mount.verifyCsrf) {
      if (
        !request.headers.get('x-zerux-csrf') ||
        request.headers.get('content-type')?.split(';')[0].trim() !==
          'application/json'
      ) {
        return false;
      }
      try {
        return (await mount.verifyCsrf(request)) === true;
      } catch {
        return false;
      }
    }
    return origin === new URL(request.url).origin;
  };
  /** Bounded fatal-UTF-8 JSON reader with owned deadline/cancellation/listener cleanup.
   * @param {Request} request - Borrowed request whose body reader is owned for this operation.
   * @param {number} limit - Total UTF-8 byte ceiling, default 8192; caller selects bounded operation-specific limit.
   * @returns {Promise<unknown>} Parsed bounded JSON; schema validation and tenant authorization remain separate.
   */
  const readBody = async (request: Request, limit = 8192) => {
    if (!request.body) {
      throw new TypeError('Body required');
    }
    /** Owned request-body reader cancelled and released in finally. */
    const reader = request.body.getReader();
    /** Fatal incremental UTF-8 decoder for bounded body parsing. */
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0,
      body = '',
      expired = false;
    /** Cooperatively cancel the owned body reader without leaking rejection.
     * @returns {void} Starts cooperative reader cancellation; finally still releases the reader.
     */
    const abort = () => {
      void reader.cancel().catch(() => {});
    };
    /** Owned body-read deadline timer cleared on all completion paths. */
    const timer = setTimeout(() => {
      expired = true;
      abort();
    }, 5000);
    request.signal.addEventListener('abort', abort, { once: true });
    try {
      // Bound bytes before accumulating each chunk; finally cancels/releases the reader.
      while (true) {
        if (expired || request.signal.aborted) {
          throw new Error('Read cancelled');
        }
        /** Bounded stream chunk or validated next CAS draft; no implicit publication occurs. */
        const next = await reader.read();
        if (expired || request.signal.aborted) {
          throw new Error('Read cancelled');
        }
        if (next.done) {
          break;
        }
        bytes += next.value.byteLength;
        if (bytes > limit) {
          throw new RangeError('Body too large');
        }
        body += decoder.decode(next.value, { stream: true });
      }
      return JSON.parse(body + decoder.decode()) as unknown;
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', abort);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  };
  /** Authenticated HTML handler; CSRF issuance never bypasses host authorization.
   * @param {Request} request - Borrowed freshly authorized admin-page request.
   * @returns {Promise<Response>} Private authenticated HTML with exact emitted-script/style CSP hashes.
   */
  const admin = async (request: Request): Promise<Response> => {
    if (!(await authorized(request))) {
      return new Response('Not found', { status: 404 });
    }

    let csrfToken = '';
    try {
      csrfToken = (await mount.issueCsrfToken?.(request)) ?? '';
      if (
        typeof csrfToken !== 'string' ||
        csrfToken.length > 1024 ||
        // eslint-disable-next-line no-control-regex -- Reject control characters; this existing validation range is intentional.
        /[\x00-\x1f]/.test(csrfToken)
      ) {
        throw new TypeError('Invalid CSRF token');
      }
    } catch {
      return json({ error: 'UI unavailable' }, 503);
    }
    /** Built-in HTML with escaped settings and separately computed exact CSP hashes. */
    const html = dashboard(prefix, {
      apiBaseUrl: apiUrl,
      csrfToken,
      styleHref,
      scriptSrc,
    });
    /** Exact emitted inline script bodies hashed for this response policy. */
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    /** Exact emitted inline style digests; no unsafe-inline permission is granted. */
    const styleHashes = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)]
      .map(
        (match) =>
          `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`
      )
      .join(' ');
    /** Derive CSP origin only from validated host asset references, never request input.
     * @param {string | undefined} asset - Optional explicitly validated host asset URL.
     * @returns {string} Validated absolute origin, self source or empty string for CSP composition.
     */
    const assetOrigin = (asset: string | undefined) => {
      if (asset) {
        if (asset.startsWith('http')) {
          return new URL(asset).origin;
        }
        return "'self'";
      }
      return '';
    };
    /** Exact emitted inline script digests for this authenticated HTML response. */
    const scriptHashes = scripts
      .map(
        (match) =>
          `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`
      )
      .join(' ');
    return new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'private, no-store',
        vary: 'Cookie, Authorization',
        'content-security-policy': `default-src 'none'; script-src ${scriptHashes} ${assetOrigin(scriptSrc)}; style-src ${styleHashes} ${assetOrigin(styleHref)}; connect-src 'self' ${publicAdminOrigin ?? ''}; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'none'`,
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'x-frame-options': 'DENY',
      },
    });
  };
  /** Authorized pure trigger dry-run; never reserves IDs, sends providers or writes analytics.
   * @param {Request} request - Protected POST carrying a bounded inert event and explicit draft/published mode.
   * @returns {Promise<Response>} Private pure dry-run result; no ID reservation, destination send or storage mutation.
   */
  const preview = async (request: Request): Promise<Response> => {
    if (!(await authorized(request))) {
      return json({ error: 'Forbidden' }, 403);
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }
    if (!(await sameOrigin(request))) {
      return json({ error: 'Origin required' }, 403);
    }
    try {
      /** Bounded parsed operation input validated before trusted store transitions. */
      const input = (await readBody(request)) as {
        name: string;
        properties?: Values;
        data?: Values;
        mode?: 'draft' | 'published';
      };
      if (
        !input ||
        Object.keys(input).some(
          (k) => !['name', 'properties', 'data', 'mode'].includes(k)
        )
      ) {
        return json({ error: 'Invalid preview scope' }, 422);
      }
      if (
        input.mode !== undefined &&
        !['draft', 'published'].includes(input.mode)
      ) {
        return json({ error: 'Invalid mode' }, 422);
      }
      if (!safeName(input.name)) {
        return json({ error: 'Invalid event name' }, 422);
      }
      /** Synthetic preview event with fixed correlation placeholder, never a real collected record. */
      const ev: TagEvent = {
        name: input.name,
        properties: cleanValues(input.properties ?? {}),
        data: cleanValues(input.data ?? {}),
        source: 'web',
        site: options.site,
        requestId: 'PREVIEWONLY00000',
        requestUtcDay: requestUtcDay(),
      };
      /** Validated current store state before selecting preview draft or publication. */
      const loaded = validateContainer(await store.load());
      /** Validated draft or published definition; preview selection never mutates or dispatches it. */
      const container =
        input.mode === 'published' ? publishedContainer(loaded) : loaded;
      validateTagProviders(container, options.providers);
      /** Fresh configured/host consent decision; preview cannot provide a consent bypass. */
      const consented =
        options.defaultConsent !== 'denied' &&
        (options.allowDispatch
          ? (await options.allowDispatch(Object.freeze(ev))) === true
          : true);
      /** Declared matching triggers under the current consent/scope policy. */
      const matched = consented ? matchedTriggers(container, ev) : [];
      /** Per-evaluation matched trigger ID set, preserving declared order. */
      const ids = new Set(matched.map((t) => t.id));
      return json({
        dryRun: true,
        mode: input.mode ?? 'draft',
        event: ev.name,
        matchedTriggers: [...ids],
        candidateTags: container.tags
          .filter(
            (t) =>
              t.enabled !== false &&
              t.triggerIds.some((id) => ids.has(id)) &&
              (t.type !== 'webhook' ||
                !!configuredDestinations[t.destinationRef ?? '']) &&
              (t.type !== 'ga4' ||
                !!credentials[t.credentialRef ?? '']?.secret) &&
              (t.type !== 'provider' ||
                options.providers!.configured(
                  t,
                  Object.keys(configuredDestinations)
                ))
          )
          .map((t) => ({ id: t.id, type: t.type })),
      });
    } catch {
      return json({ error: 'Invalid preview' }, 422);
    }
  };
  /** Fresh-authorized read/CAS draft write handler; saving never publishes implicitly.
   * @param {Request} request - Fresh-authorized GET or Origin/CSRF-safe PUT with explicit next revision.
   * @returns {Promise<Response>} Private loaded document or draft-only CAS result, never implicit publication.
   */
  const api = async (request: Request): Promise<Response> => {
    if (!(await authorized(request))) {
      return json({ error: 'Forbidden' }, 403);
    }
    if (request.method === 'GET') {
      try {
        return json(validateContainer(await store.load()));
      } catch {
        return json({ error: 'Container unavailable' }, 503);
      }
    }
    if (request.method !== 'PUT') {
      return json({ error: 'Method not allowed' }, 405);
    }
    if (!(await sameOrigin(request))) {
      return json({ error: 'Origin required' }, 403);
    }
    let parsed: TagContainer;
    try {
      parsed = validateContainer(await readBody(request, 128 * 1024));
      validateTagProviders(parsed, options.providers);
    } catch {
      return json({ error: 'Invalid container' }, 422);
    }
    try {
      if (
        !(await saveTagDraft(
          store,
          parsed,
          parsed.version - 1,
          options.providers
        ))
      ) {
        return json({ error: 'Version conflict' }, 409);
      }
      return json({ ok: true, version: parsed.version, mode: 'draft' });
    } catch {
      return json(
        { error: 'Draft storage unavailable', committed: 'unknown' },
        503
      );
    }
  };
  /** Fresh-authorized bounded definition import/export; import is draft-only.
   * @param {Request} request - Fresh-authorized bounded definition transfer request.
   * @param {'import' | 'export'} mode - Explicit import/export operation; imports save only a draft.
   * @returns {Promise<Response>} Private validated export or draft import result; incompatible schemas reject.
   */
  const transfer = async (request: Request, mode: 'import' | 'export') => {
    if (!(await authorized(request))) {
      return json({ error: 'Forbidden' }, 403);
    }
    if (request.method !== (mode === 'import' ? 'POST' : 'GET')) {
      return json({ error: 'Method not allowed' }, 405);
    }
    if (
      mode === 'import' &&
      (!(await sameOrigin(request)) ||
        request.headers.get('content-type')?.split(';')[0].trim() !==
          'application/json')
    ) {
      return json({ error: 'Origin required' }, 403);
    }
    try {
      if (mode === 'export') {
        return new Response(
          exportTagDefinition(await store.load(), options.providers),
          {
            headers: {
              'content-type': 'application/json',
              'cache-control': 'private, no-store',
              'content-disposition':
                'attachment; filename="tag-definition.json"',
              vary: 'Cookie, Authorization',
            },
          }
        );
      }
      /** Bounded parsed operation input validated before trusted store transitions. */
      const input = (await readBody(request, 128 * 1024)) as {
        expectedVersion: number;
        definition: string;
      };
      if (
        !input ||
        Object.keys(input).some(
          (k) => !['expectedVersion', 'definition'].includes(k)
        ) ||
        !Number.isSafeInteger(input.expectedVersion) ||
        input.expectedVersion < 1
      ) {
        throw new TypeError('Invalid import revision');
      }
      /** Validated candidate whose provider schemas and active destinations must be available. */
      const candidate = importTagDefinition(
        input.definition,
        options.providers
      );
      if (
        candidate.tags.some(
          (tag) =>
            tag.enabled !== false &&
            ((tag.type === 'provider' &&
              !options.providers!.configured(
                tag,
                Object.keys(configuredDestinations)
              )) ||
              (tag.type === 'webhook' &&
                !configuredDestinations[tag.destinationRef ?? '']) ||
              (tag.type === 'ga4' &&
                !credentials[tag.credentialRef ?? '']?.secret))
        )
      ) {
        throw new TypeError('Unconfigured imported destination');
      }
      /** Bounded stream chunk or validated next CAS draft; no implicit publication occurs. */
      const next = { ...candidate, version: input.expectedVersion + 1 };
      if (
        !(await saveTagDraft(
          store,
          next,
          input.expectedVersion,
          options.providers
        ))
      ) {
        return json({ error: 'Version conflict' }, 409);
      }
      return json({ ok: true, version: next.version, mode: 'draft' });
    } catch {
      return json({ error: 'Invalid or incompatible tag definition' }, 422);
    }
  };
  /** Authorized schema-only handler with no save or publication mutation.
   * @param {Request} request - Fresh-authorized protected POST with a bounded candidate definition.
   * @returns {Promise<Response>} Private schema/provider validation result without storage mutation.
   */
  const validate = async (request: Request) => {
    if (!(await authorized(request))) {
      return json({ error: 'Forbidden' }, 403);
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }
    if (!(await sameOrigin(request))) {
      return json({ error: 'Origin required' }, 403);
    }
    try {
      /** Validated candidate whose provider schemas and active destinations must be available. */
      const candidate = validateContainer(await readBody(request, 128 * 1024));
      validateTagProviders(candidate, options.providers);
      return json({ ok: true, version: candidate.version });
    } catch {
      return json({ error: 'Invalid or incompatible container' }, 422);
    }
  };
  /** Authorized revision/release metadata handler; errors do not expose stored payloads.
   * @param {Request} request - Fresh-authorized GET metadata request.
   * @returns {Promise<Response>} Private draft/live revision and bounded retained release metadata.
   */
  const status = async (request: Request) => {
    if (!(await authorized(request))) {
      return json({ error: 'Forbidden' }, 403);
    }
    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed' }, 405);
    }
    return json(releaseSummary(await store.load()));
  };
  /** Separately authorized publish/rollback CAS workflow with explicit audit intent/receipt outcomes.
   * @param {Request} request - Fresh editor/publisher-authorized protected request.
   * @param {'publish' | 'rollback'} action - Explicit publish/rollback operation selected by a fixed route.
   * @returns {Promise<Response>} CAS/audit receipt distinguishing conflict, committed and uncertain failures without automatic replay.
   */
  const transition = async (
    request: Request,
    action: 'publish' | 'rollback'
  ) => {
    if (!(await canPublish(request))) {
      return json({ error: 'Forbidden' }, 403);
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }
    if (!(await sameOrigin(request))) {
      return json({ error: 'Origin required' }, 403);
    }
    try {
      /** Bounded transition arguments with required optimistic revision and optional retained release ID. */
      const payload = (await readBody(request)) as {
        expectedVersion?: number;
        releaseId?: number;
      };
      if (
        !payload ||
        !Number.isSafeInteger(payload.expectedVersion) ||
        payload.expectedVersion! < 1 ||
        (action === 'rollback' &&
          (!Number.isSafeInteger(payload.releaseId) || payload.releaseId! < 1))
      ) {
        return json({ error: 'Invalid transition' }, 422);
      }
      if (action === 'publish') {
        /** Validated candidate whose provider schemas and active destinations must be available. */
        const candidate = validateContainer(await store.load());
        validateTagProviders(candidate, options.providers);
        if (
          candidate.tags.some(
            (tag) =>
              tag.type === 'provider' &&
              !options.providers!.configured(
                tag,
                Object.keys(configuredDestinations)
              )
          )
        ) {
          throw new TypeError('Unconfigured provider destination');
        }
        if (candidate.version !== payload.expectedVersion) {
          return json({ error: 'Version conflict' }, 409);
        }
        if (
          candidate.tags.some(
            (tag) =>
              tag.enabled !== false &&
              ((tag.type === 'ga4' &&
                !credentials[tag.credentialRef ?? '']?.secret) ||
                (tag.type === 'webhook' &&
                  !configuredDestinations[tag.destinationRef ?? '']))
          )
        ) {
          return json({ error: 'Unconfigured destination' }, 422);
        }
      }
      if (action === 'rollback') {
        /** Validated current stored document; CAS remains authoritative against concurrent changes. */
        const current = validateContainer(await store.load());
        /** Explicit retained rollback snapshot; missing history is never invented. */
        const target =
          current.governance?.history.find((r) => r.id === payload.releaseId)
            ?.container ??
          (!current.governance && payload.releaseId === 1
            ? current
            : undefined);
        if (target) {
          validateTagProviders(target, options.providers);
          if (
            target.tags.some(
              (tag) =>
                tag.enabled !== false &&
                ((tag.type === 'provider' &&
                  !options.providers!.configured(
                    tag,
                    Object.keys(configuredDestinations)
                  )) ||
                  (tag.type === 'webhook' &&
                    !configuredDestinations[tag.destinationRef ?? '']) ||
                  (tag.type === 'ga4' &&
                    !credentials[tag.credentialRef ?? '']?.secret))
            )
          ) {
            throw new TypeError('Unconfigured rollback destination');
          }
        }
      }
      let auditEvent: TagAdminAuditEvent | undefined;
      if (mount.audit) {
        try {
          /** Explicit scalar context or fresh host audit grant; neither is taken from browser role claims. */
          const context = await mount.auditContext!(request);
          if (
            !context ||
            ![context.tenant, context.actor].every(
              (v) => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(v)
            )
          ) {
            throw new Error('Invalid audit context');
          }
          /** Validated current stored document; CAS remains authoritative against concurrent changes. */
          const current = validateContainer(await store.load());
          auditEvent = {
            version: 1,
            operationId: randomUUID(),
            phase: 'intent',
            action,
            tenant: context.tenant,
            actor: context.actor,
            at: Date.now(),
            expectedVersion: payload.expectedVersion!,
            ...(payload.releaseId !== undefined
              ? { releaseId: payload.releaseId }
              : {}),
            definitionHash: createHash('sha256')
              .update(
                JSON.stringify(
                  action === 'publish'
                    ? { ...current, governance: undefined }
                    : (current.governance?.history.find(
                        (r) => r.id === payload.releaseId
                      )?.container ?? publishedContainer(current))
                )
              )
              .digest('hex'),
          };
          await mount.audit(Object.freeze(auditEvent));
        } catch {
          return json({ error: 'Audit unavailable', committed: false }, 503);
        }
      }
      /** Store-reported CAS result; unknown acknowledgements are never automatically retried. */
      const success =
        action === 'publish'
          ? await publishTagDraft(
              store,
              payload.expectedVersion!,
              options.providers
            )
          : await rollbackTagRelease(
              store,
              payload.expectedVersion!,
              payload.releaseId!,
              options.providers
            );
      if (!success) {
        let audit = 'recorded';
        if (auditEvent) {
          try {
            await mount.audit!(
              Object.freeze({
                ...auditEvent,
                phase: 'conflict',
                at: Date.now(),
              })
            );
          } catch {
            audit = 'unavailable';
          }
        }
        return json({ error: 'Version conflict', audit }, 409);
      }
      if (auditEvent) {
        try {
          await mount.audit!(
            Object.freeze({
              ...auditEvent,
              phase: 'committed',
              at: Date.now(),
              revision: payload.expectedVersion! + 1,
            })
          );
        } catch {
          return json(
            {
              error: 'Audit unavailable',
              committed: true,
              version: payload.expectedVersion! + 1,
            },
            503
          );
        }
      }
      try {
        return json({ ok: true, ...releaseSummary(await store.load()) });
      } catch {
        return json({
          ok: true,
          committed: true,
          version: payload.expectedVersion! + 1,
          statusUnavailable: true,
        });
      }
    } catch (error) {
      return error instanceof RangeError ||
        error instanceof TypeError ||
        error instanceof SyntaxError
        ? json(
            {
              error:
                error instanceof RangeError
                  ? 'Release unavailable'
                  : 'Invalid transition',
            },
            422
          )
        : json({ error: 'Transition unavailable', committed: 'unknown' }, 503);
    }
  };
  /** Private no-store exact-origin wrapper retaining actual handler/audit work until settlement.
   * @param {(request: Request) => Promise<Response>} handler - Fixed trusted administrative handler; wrapper owns admission, exact CORS and actual-settlement tracking.
   * @returns {Function} Protected handler; each real operation still performs fresh authorization.
   */
  const protectedRoute =
    (handler: (request: Request) => Promise<Response>) =>
    (request: Request): Promise<Response> => {
      /** Raw request Origin compared only to exact configured/same-origin policy. */
      const origin = request.headers.get('origin');
      /** Whether request Origin exactly matches its API request origin. */
      const same = origin === new URL(request.url).origin;
      /** Whether exact request Origin is permitted; this is not authentication. */
      const allowed = !!origin && (same || adminOrigins.has(origin));
      /** Wrap every protected response with privacy/CORS metadata without exposing private configuration.
       * @param {Response} response - Handler response whose body/status are preserved while private/CORS headers are enforced.
       * @returns {Response} Independent response wrapper with exact approved credentialed Origin policy.
       */
      const finish = (response: Response) => {
        /** Independent response header copy for privacy and exact credentialed CORS. */
        const headers = new Headers(response.headers);
        headers.set('cache-control', 'private, no-store');
        headers.set('vary', 'Origin, Cookie, Authorization');
        if (allowed) {
          headers.set('access-control-allow-origin', origin!);
          headers.set('access-control-allow-credentials', 'true');
        }
        return new Response(response.body, {
          status: response.status,
          headers,
        });
      };
      if (closed) {
        return Promise.resolve(finish(json({ error: 'Closed' }, 503)));
      }
      if (origin && !allowed) {
        return Promise.resolve(finish(json({ error: 'Origin denied' }, 403)));
      }
      if (request.method === 'OPTIONS') {
        /** Requested preflight method checked against explicit GET/POST/PUT support. */
        const method = request.headers.get('access-control-request-method');
        /** Normalized requested preflight header names, checked against the fixed protocol allowlist. */
        const headers = (
          request.headers.get('access-control-request-headers') ?? ''
        )
          .split(',')
          .map((v) => v.trim().toLowerCase())
          .filter(Boolean);
        if (
          !allowed ||
          !['GET', 'POST', 'PUT'].includes(method ?? '') ||
          headers.some(
            (v) =>
              !['content-type', 'x-zerux-csrf', 'authorization'].includes(v)
          )
        ) {
          return Promise.resolve(
            finish(json({ error: 'Preflight denied' }, 403))
          );
        }
        /** Native Fetch response with body cancellation after bounded status inspection, or fixed private HTTP result. */
        const response = finish(new Response(null, { status: 204 }));
        response.headers.set('access-control-allow-methods', 'GET, POST, PUT');
        response.headers.set(
          'access-control-allow-headers',
          'Content-Type, X-Zerux-CSRF, Authorization'
        );
        return Promise.resolve(response);
      }
      if (adminJobs.size >= adminMax) {
        return Promise.resolve(
          finish(json({ error: 'Admin overloaded' }, 503))
        );
      }
      /** Actual protected handler promise retained through response policy and cleanup. */
      const job = Promise.resolve()
        .then(() => handler(request))
        .catch(() => json({ error: 'Admin operation unavailable' }, 503))
        .then(finish)
        .finally(() => adminJobs.delete(job));
      adminJobs.add(job);
      return job;
    };
  return {
    createAstag,
    evaluate,
    /** Inspect fixed lifecycle counters without per-event or tenant payload labels.
     * @returns {object} Closed state and actual dispatch/admin pending counts.
     */
    status: () => ({
      closed,
      pending: jobs.size,
      adminPending: adminJobs.size,
    }),
    /** Stop new work, abort cooperative dispatches and drain actual admin/dispatch settlement.
     * @returns {Promise<void>} Shared drain, followed by owned-provider disposal; borrowed stores stay open.
     */
    close() {
      if (closing) {
        return closing;
      }
      closed = true;
      // Stop cooperative dispatch admission before draining actual jobs and owned providers.
      for (const c of controllers) {
        c.abort();
      }
      return (closing = (async () => {
        await Promise.allSettled([...jobs, ...adminJobs]);
        if (options.ownProviders) {
          await options.providers?.close();
        }
      })());
    },
    /** Read the borrowed store directly for trusted host integration, without HTTP authorization.
     * @returns {Promise<TagContainer>} Raw store document; host must not expose it without authorization.
     */
    container: () => store.load(),
    /** Read a validated live snapshot for trusted host integration, without HTTP authorization.
     * @returns {Promise<TagContainer>} Independent published definition; direct host access remains privileged.
     */
    published: async () => publishedContainer(await store.load()),
    store,
    /** Declare exact collection/bootstrap and independently protected administration routes.
     * @returns {Array<object>} Inert route descriptors; host owns registration, listener lifetime and teardown.
     */
    routes() {
      /** Explicit inert protected route declarations; host registration and listener ownership remain separate. */
      const adminRoutes = [
        ...(mount.serveUi === false
          ? []
          : [{ pattern: uiPath, handler: protectedRoute(admin) }]),
        { pattern: adminBase + '/api', handler: protectedRoute(api) },
        { pattern: adminBase + '/validate', handler: protectedRoute(validate) },
        { pattern: adminBase + '/preview', handler: protectedRoute(preview) },
        {
          pattern: adminBase + '/import',
          handler: protectedRoute((request) => transfer(request, 'import')),
        },
        {
          pattern: adminBase + '/export',
          handler: protectedRoute((request) => transfer(request, 'export')),
        },
        { pattern: adminBase + '/status', handler: protectedRoute(status) },
        {
          pattern: adminBase + '/publish',
          handler: protectedRoute((request) => transition(request, 'publish')),
        },
        {
          pattern: adminBase + '/rollback',
          handler: protectedRoute((request) => transition(request, 'rollback')),
        },
      ];
      return [
        {
          pattern: collector.path,
          handler: (request: Request) =>
            closed
              ? Promise.resolve(json({ error: 'Closed' }, 503))
              : collector.handler(request),
        },
        { pattern: `${prefix}/ttag.js`, handler: scriptHandler },
        ...(options.authorizeAdmin ? adminRoutes : []),
      ];
    },
  };
}
