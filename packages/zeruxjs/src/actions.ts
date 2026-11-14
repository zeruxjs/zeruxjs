import { randomBytes } from 'node:crypto';
import { createMessageAuthenticator } from '@zeruxjs/security/crypto';
import {
  createHttpInputAdapter,
  HttpValidationError,
  type ClientIssue,
} from '@zeruxjs/validator/http';
import {
  unknown,
  type GenericSchema,
  type GenericSchemaAsync,
  type InferOutput,
} from '@zeruxjs/validator/schemas';
import { isSameOriginRequest, type CsrfTokenManager } from '@zeruxjs/security';
import {
  escapeHtmlText,
  escapeHtmlAttribute,
} from '@zeruxjs/security/encoding';
import {
  normalizeApiError,
  ApplicationError,
  acceptsApiError,
} from './exceptions/api-error.js';
import { createFetchRoute } from './fetch-route.js';
import type { ZeruxPluginApi, ZeruxRequestContext } from './bootstrap/types.js';
import type { ActionStore, ActionClaim } from './action-stores.js';
export type { ActionStore, ActionClaim } from './action-stores.js';
export interface ActionPrincipal {
  /** Fresh server-verified tenant binding. */
  readonly tenant: string;
  /** Fresh server-verified opaque subject identity. */
  readonly subject: string;
  /** Private verified session binding for CSRF issuance/verification. */
  readonly sessionId: string;
}
export interface ActionContext {
  /** Immutable verified tenant/subject/session scope. */
  readonly principal: Readonly<ActionPrincipal>;
  /** Cooperative protected-work cancellation signal. */
  readonly signal: AbortSignal;
  /** Absolute operation deadline in Unix milliseconds. */
  readonly deadline: number;
}
export interface ActionReference<I = unknown> {
  /** Fixed public same-origin action route URL. */
  readonly url: string;
  /** Signed opaque registry-local action identity. */
  readonly ref: string;
  /** Type-only marker preserving schema input/reference compatibility. */
  readonly inputType?: I;
}
export interface ActionForm {
  /** Fixed public form destination issued by the registry. */
  readonly action: string;
  /** Ordinary browser-compatible POST submission method. */
  readonly method: 'post';
  /** Signed action-key and session CSRF control projection only. */
  readonly fields: Readonly<{
    /** Principal-bound expiring signed form key. */
    _action_key: string; /** Host session-bound CSRF value. */
    _action_csrf: string;
  }>;
}
export interface ActionDefinition<
  S extends GenericSchema | GenericSchemaAsync,
  T,
> {
  /** Package-owned input schema; runtime validation precedes authorization/write. */
  schema: S;
  /** Reauthorize the validated mutation under the fresh initiating host principal.
   * @param {InferOutput<S>} input - Canonical immutable schema output.
   * @param {ActionContext} context - Fresh verified principal, cancellation and deadline.
   * @returns {boolean | Promise<boolean>} Only true admits persistent claim/commit work.
   */
  authorize(
    input: InferOutput<S>,
    context: ActionContext
  ): boolean | Promise<boolean>;
  /** Perform database-only mutation work on the exact store-supplied transaction pin; external side effects require separate host workflows.
   * @param {T} tx - Borrowed persistent store transaction pin.
   * @param {InferOutput<S>} input - Canonical immutable schema output.
   * @param {ActionContext} context - Fresh principal/cancellation/deadline projection.
   * @returns {void | Promise<void>} Actual pin-bound persistence settlement; synchronous stores reject async definitions.
   */
  write(
    tx: T,
    input: InferOutput<S>,
    context: ActionContext
  ): void | Promise<void>;
  /** Validated local postcommit destination. */
  successRedirect: string;
  /** Refresh derived cache state only after confirmed persistence, including committed replays; the host callback must be idempotent.
   * @param {ActionContext} context - Verified principal with independent bounded postcommit cancellation/deadline.
   * @returns {void | Promise<void>} Actual invalidation settlement; failure reports committed state rather than replaying the write.
   */
  invalidate?(context: ActionContext): void | Promise<void>;
}
/** Validate bounded principal identity strings without coercion.
 * @param {unknown} value - Candidate host identity field.
 * @returns {boolean} Whether the field is a nonempty bounded string without controls.
 */
const text = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 128 &&
  // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
  !/[\x00-\x1f\x7f]/.test(value);
/** Validate and freeze only fresh host-verified tenant/subject/session fields.
 * @param {ActionPrincipal} value - Private host authentication result.
 * @returns {Readonly<ActionPrincipal>} Immutable verified-shape principal; host authentication still establishes identity.
 */
function principal(value: ActionPrincipal): Readonly<ActionPrincipal> {
  if (
    !value ||
    !text(value.tenant) ||
    !text(value.subject) ||
    !text(value.sessionId)
  ) {
    throw new ApplicationError(401);
  }
  return Object.freeze({
    tenant: value.tenant,
    subject: value.subject,
    sessionId: value.sessionId,
  });
}
/** Validate a same-origin local redirect path without controls, backslashes or protocol-relative authority.
 * @param {string} value - Authored success redirect path.
 * @returns {string} Validated local redirect path.
 */
function local(value: string) {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    !/^\/(?!\/)/.test(value) ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
    /[\\\x00-\x20\x7f]/.test(value)
  ) {
    throw new TypeError('Invalid action redirect');
  }
  return value;
}
/** Fingerprint bounded inert validated JSON using own data descriptors, never getters or toJSON callbacks.
 * @param {unknown} input - Schema output candidate.
 * @returns {string} Deterministic bounded canonical JSON text.
 */
function canonical(input: unknown): string {
  let entries = 0;
  /** Current JSON recursion path used to reject cyclic input before fingerprinting. */
  const ancestors = new Set<object>();
  /** Rebuild bounded inert plain JSON using own data descriptors and sorted keys.
   * @param {unknown} value - Candidate validated schema output.
   * @param {number} depth - Current bounded recursion depth.
   * @returns {unknown} Canonical plain JSON projection without getter or toJSON execution.
   */
  const visit = (value: any, depth: number): any => {
    if (++entries > 2000 || depth > 24) {
      throw new ApplicationError(413);
    }
    if (typeof value === 'string' && value.length > 131072) {
      throw new ApplicationError(413);
    }
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    ) {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (
      !value ||
      typeof value !== 'object' ||
      ancestors.has(value) ||
      (!Array.isArray(value) &&
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    ) {
      throw new ApplicationError(422);
    }
    ancestors.add(value);
    /** Fresh null-prototype object or array used for the canonical input projection. */
    const result: any = Array.isArray(value) ? [] : Object.create(null);
    if (Reflect.ownKeys(value).length > 1000) {
      throw new ApplicationError(413);
    }
    for (const key of Object.keys(value).sort()) {
      /** Own data descriptor inspected without invoking a getter. */
      const property = Object.getOwnPropertyDescriptor(value, key)!;
      if (
        !('value' in property) ||
        ['__proto__', 'constructor', 'prototype'].includes(key)
      ) {
        throw new ApplicationError(422);
      }
      result[key] = visit(property.value, depth + 1);
    }
    ancestors.delete(value);
    return result;
  };
  /** Canonical serialized input checked against the final byte ceiling. */
  const json = JSON.stringify(visit(input, 0));
  if (Buffer.byteLength(json) > 131072) {
    throw new ApplicationError(413);
  }
  return json;
}
/** Render only escaped hidden action control fields from an issued form descriptor.
 * @param {ActionForm} form - Registry-issued signed/CSRF form controls.
 * @returns {string} Escaped hidden input markup without submitted private values.
 */
export function renderActionFields(form: ActionForm): string {
  return Object.entries(form.fields)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtmlAttribute(name)}" value="${escapeHtmlAttribute(value)}">`
    )
    .join('');
}
/** Create an explicit private server registry with no listener startup; require a durable atomic claim/commit store.
 * @param {{ origin: string; key: Uint8Array; csrf: CsrfTokenManager; store: ActionStore<T>; authenticate: ( request: Request, context?: ZeruxRequestContext ) => Promise<ActionPrincipal | null>; maxBytes?: number; maxFields?: number; timeoutMs?: number; maxActive?: number; ttlMs?: number; clockSkewMs?: number; path?: string; }} options - Private host origin/key/CSRF/auth/store policy and bounded dispatch settings.
 * @param {string} options.origin - Trusted fixed application origin.
 * @param {Uint8Array} options.key - Private 32-byte signing material, copied before use.
 * @param {CsrfTokenManager} options.csrf - Borrowed session-bound CSRF owner.
 * @param {ActionStore<T>} options.store - Borrowed durable atomic claim/commit store.
 * @param {Function} options.authenticate - Fresh host request authentication callback.
 * @param {number} options.maxBytes - Optional encoded body ceiling.
 * @param {number} options.maxFields - Optional field count ceiling including controls.
 * @param {number} options.timeoutMs - Optional cooperative dispatch deadline.
 * @param {number} options.maxActive - Optional actual unsettled job ceiling.
 * @param {number} options.ttlMs - Optional signed key lifetime.
 * @param {number} options.clockSkewMs - Optional bounded expiry tolerance.
 * @param {string} options.path - Optional fixed local action namespace.
 * @returns {object} Owned registry with explicit registration, form issuance, dispatch, attachment and close.
 */
export function createActionRegistry<T>(options: {
  /** Explicit trusted application origin bound into signatures. */
  origin: string;
  /** Private 32-byte signing key copied and zeroed by this registry. */
  key: Uint8Array;
  /** Borrowed trusted CSRF issuer/verifier; no browser secret is configured. */
  csrf: CsrfTokenManager;
  /** Borrowed durable action-atomic-v1 persistent claim/commit owner. */
  store: ActionStore<T>;
  /** Fresh host request authentication callback. */
  authenticate: (
    request: Request,
    context?: ZeruxRequestContext
  ) => Promise<ActionPrincipal | null>;
  /** Bounded total URL-encoded body bytes. */
  maxBytes?: number;
  /** Bounded total fields, including action controls. */
  maxFields?: number;
  /** Cooperative whole-dispatch deadline. */
  timeoutMs?: number;
  /** Maximum actual unsettled dispatches. */
  maxActive?: number;
  /** Expiring signed form-key lifetime. */
  ttlMs?: number;
  /** Bounded issued-key clock tolerance/record retention allowance. */
  clockSkewMs?: number;
  /** Fixed validated protected action URL namespace. */
  path?: string;
}) {
  if (
    !options ||
    !(options.key instanceof Uint8Array) ||
    options.key.length !== 32 ||
    typeof options.authenticate !== 'function' ||
    typeof options.csrf?.verify !== 'function' ||
    typeof options.csrf.issue !== 'function' ||
    options.store?.capability !== 'action-atomic-v1' ||
    options.store.durable !== true ||
    typeof options.store.synchronous !== 'boolean' ||
    typeof options.store.claim !== 'function' ||
    typeof options.store.commit !== 'function' ||
    typeof options.origin !== 'string' ||
    options.origin.length > 2048 ||
    !isSameOriginRequest(options.origin, options.origin)
  ) {
    throw new TypeError('Invalid action registry');
  }
  /** Owned copy of the host signing key, zeroed after active work drains. */
  const key = Buffer.from(options.key);
  /** Explicit same-origin authority bound into every action signature. */
  const origin = options.origin;
  /** Borrowed durable atomic claim/commit owner; this registry never closes it. */
  const store = options.store;
  /** Explicit host authenticator invoked before schema authorization or claim. */
  const authenticate = options.authenticate;
  /** Bound trusted CSRF issue/verify callbacks; signatures alone do not replace session-bound CSRF. */
  const csrf = {
    issue: options.csrf.issue.bind(options.csrf),
    verify: options.csrf.verify.bind(options.csrf),
  };
  /** Validated URL-encoded request byte ceiling. */
  const maxBytes = options.maxBytes ?? 32768;
  /** Validated total form field ceiling including action controls. */
  const maxFields = options.maxFields ?? 64;
  /** Validated cooperative dispatch deadline in milliseconds. */
  const timeout = options.timeoutMs ?? 10000;
  /** Validated ceiling on actual unsettled action jobs. */
  const maxActive = options.maxActive ?? 32;
  /** Maximum issued action-key lifetime. */
  const ttl = options.ttlMs ?? 900000;
  /** Bounded expiry/skew allowance used for durable claim retention. */
  const skew = options.clockSkewMs ?? 5000;
  /** Validated fixed action URL namespace, included in signing purpose messages. */
  const prefix = options.path ?? '/_zerux/actions';
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 128 ||
    maxBytes > 131072 ||
    !Number.isSafeInteger(maxFields) ||
    maxFields < 2 ||
    maxFields > 200 ||
    !Number.isSafeInteger(timeout) ||
    timeout < 10 ||
    timeout > 60000 ||
    !Number.isSafeInteger(maxActive) ||
    maxActive < 1 ||
    maxActive > 1024 ||
    !Number.isSafeInteger(ttl) ||
    ttl < 1000 ||
    ttl > 86400000 ||
    !Number.isSafeInteger(skew) ||
    skew < 0 ||
    skew > 60000 ||
    prefix.length > 512 ||
    !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(prefix)
  ) {
    throw new TypeError('Invalid action limits');
  }
  /** Owned security-package message authenticator; no private key is serialized to forms. */
  const authenticator = createMessageAuthenticator({
    current: { id: 'actions-v1', key },
    maxBytes: 524288,
  });
  /** Fixed signing domain separating action tokens from other application records. */
  const purpose = 'zeruxjs.actions.v1';
  /** Build an origin/path-bound signing tuple without ambiguous string concatenation.
   * @param {unknown[]} parts - Explicit inert internal signing tuple fields.
   * @returns {string} JSON signing message.
   */
  const message = (...parts: unknown[]) =>
    JSON.stringify([origin, prefix, ...parts]);
  /** Sign an explicitly scoped internal action tuple.
   * @param {unknown[]} parts - Validated internal identity/input/token fields.
   * @returns {string} Security-owned HMAC tag.
   */
  const sign = (...parts: unknown[]) =>
    authenticator.sign(message(...parts), purpose).tag;
  /** Private registry-local reference identities and trusted action definitions. */
  const entries = new Map<
    string,
    {
      /** Immutable reference whose identity belongs to this registry. */
      token: ActionReference<any>; /** Private captured trusted callbacks and schema. */
      definition: ActionDefinition<any, T>;
    }
  >();
  /** Actual unsettled action dispatches retained for capacity and close draining. */
  const jobs = new Set<Promise<unknown>>();
  /** Owned dispatch/postcommit invalidation cancellation controllers. */
  const controllers = new Set<AbortController>();
  let sealed = false,
    closed = false,
    closing: Promise<void> | undefined;
  /** Accept only this registry’s immutable reference identity while it remains open.
   * @param {ActionReference<unknown>} reference - Registry-issued reference token.
   * @returns {object} Captured private definition and token; unknown references reject.
   */
  const match = (reference: ActionReference<any>) => {
    /** Captured registry-local action definition selected only by token identity. */
    const entry = entries.get(reference?.ref);
    if (closed || entry?.token !== reference) {
      throw new TypeError('Unknown action reference');
    }
    return entry;
  };
  /** Issue one principal-bound signed form key and session-bound CSRF value.
   * @param {ActionReference<unknown>} reference - Registry-issued reference.
   * @param {ActionPrincipal} identity - Fresh verified host principal.
   * @returns {ActionForm} Immutable same-origin POST form descriptor; no server code enters HTML.
   */
  const issue = (
    reference: ActionReference<any>,
    identity: ActionPrincipal
  ): ActionForm => {
    match(reference);
    /** Immutable validated host tenant/subject/session projection. */
    const who = principal(identity);
    /** Issued absolute key expiry or parsed expiry validated against lifetime/skew. */
    const expires = Date.now() + ttl;
    /** Fresh cryptographic per-form entropy preventing predictable claim keys. */
    const nonce = randomBytes(24).toString('base64url');
    /** Session-bound host CSRF issue result validated before public form projection. */
    const csrfToken = csrf.issue(who.sessionId);
    /** Signed expiry/nonce pair; no session identifier is exposed in form fields. */
    const payload = `${expires}.${nonce}`;
    /** Principal/action/origin/path-bound HMAC for the issued key. */
    const signature = sign(
      'key',
      reference.ref,
      who.tenant,
      who.subject,
      payload
    );
    if (
      typeof csrfToken !== 'string' ||
      !csrfToken ||
      csrfToken.length > 512 ||
      // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
      /[\x00-\x1f\x7f]/.test(csrfToken)
    ) {
      throw new TypeError('Invalid CSRF provider result');
    }
    return Object.freeze({
      action: reference.url,
      method: 'post',
      fields: Object.freeze({
        _action_key: `${payload}.${signature}`,
        _action_csrf: csrfToken,
      }),
    });
  };
  /** Validate signed expiry/nonce syntax and initiating principal binding before deriving the durable claim key.
   * @param {unknown} token - Untrusted submitted action key.
   * @param {string} ref - Registered signed action reference.
   * @param {ActionPrincipal} who - Fresh verified initiating principal.
   * @returns {{expires: number; key: string}} Verified expiry and principal-bound opaque claim record key.
   */
  const verify = (token: unknown, ref: string, who: ActionPrincipal) => {
    if (typeof token !== 'string' || token.length > 128) {
      throw new ApplicationError(400);
    }
    /** Untrusted token components; anchored grammar and arity checks run before signature verification. */
    const [time, nonce, signature, ...extra] = token.split('.');
    /** Issued absolute key expiry or parsed expiry validated against lifetime/skew. */
    const expires = Number(time);
    if (
      extra.length ||
      !/^\d{13,16}$/.test(time!) ||
      !Number.isSafeInteger(expires) ||
      expires <= Date.now() ||
      expires > Date.now() + ttl + skew ||
      !/^[A-Za-z0-9_-]{32}$/.test(nonce!) ||
      !/^[A-Za-z0-9_-]{43}$/.test(signature!)
    ) {
      throw new ApplicationError(409);
    }
    if (
      !authenticator.verify(
        message('key', ref, who.tenant, who.subject, `${time}.${nonce}`),
        { v: 1, alg: 'HS256', kid: 'actions-v1', tag: signature! },
        purpose
      )
    ) {
      throw new ApplicationError(403);
    }
    return {
      expires,
      key: sign('record', ref, who.tenant, who.subject, nonce),
    };
  };
  /** Project bounded field/form issues without echoing submitted values or internal causes.
   * @param {number} status - Explicit safe HTTP failure status.
   * @param {Request} request - Borrowed request used only for representation negotiation.
   * @param {readonly ClientIssue[]} issues - Private validator issues reduced to bounded paths/codes and fixed messages.
   * @param {string | undefined} outcome - Explicit committed/uncertain state when persistence was attempted.
   * @returns {Response} Private negotiated JSON or script-free escaped HTML response.
   */
  const response = (
    status: number,
    request: Request,
    issues: readonly ClientIssue[] = [],
    outcome?: 'committed' | 'uncertain'
  ) => {
    /** Safe shared API-error projection; private causes remain excluded. */
    const normalized = normalizeApiError(new ApplicationError(status));
    /** Bounded field-path/code projection with fixed public validation messages. */
    const safe = issues.slice(0, 20).map((issue) => ({
      path: issue.path.slice(0, 300),
      code: issue.code,
      message: 'Invalid input',
    }));
    /** Private negotiated action error envelope excluding original input values. */
    const data = {
      ok: false,
      error: normalized.body.error,
      issues: safe,
      ...(outcome ? { outcome } : {}),
    };
    if (acceptsApiError(request.headers.get('accept'))) {
      return Response.json(data, {
        status,
        headers: {
          'cache-control': 'no-store',
          vary: 'Accept',
          ...(status === 405 ? { allow: 'POST' } : {}),
        },
      });
    }
    return new Response(
      `<!doctype html><html><head><title>Form not submitted</title></head><body><main><h1>Form not submitted</h1><p>${escapeHtmlText(normalized.body.error.message)}</p><ul>${safe.map((issue) => `<li>${escapeHtmlText(issue.path)}: Invalid input</li>`).join('')}</ul></main></body></html>`,
      {
        status,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          vary: 'Accept',
          ...(status === 405 ? { allow: 'POST' } : {}),
          'content-security-policy':
            "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
          'x-content-type-options': 'nosniff',
        },
      }
    );
  };
  /** Dispatch one bounded same-origin POST with fresh auth/CSRF/schema checks and durable principal-bound idempotence.
   * @param {ActionReference<unknown>} reference - Registry-issued action authority.
   * @param {Request} request - Borrowed native Fetch request.
   * @param {ZeruxRequestContext | undefined} requestContext - Optional generation request lifecycle context.
   * @returns {Promise<Response>} Private explicit committed/uncertain/rejected result; ambiguous writes never auto-replay.
   */
  const handle = (
    reference: ActionReference<any>,
    request: Request,
    requestContext?: ZeruxRequestContext
  ): Promise<Response> => {
    if (!(request instanceof Request)) {
      throw new TypeError('Expected action request');
    }
    /** Captured registry-local action definition selected only by token identity. */
    const entry = match(reference);
    sealed = true;
    if (jobs.size >= maxActive) {
      return Promise.resolve(response(429, request));
    }
    /** Action-owned cancellation owner retained through actual adapter/store cleanup. */
    const controller = new AbortController();
    /** Borrowed request/lifecycle abort signals observed only for this dispatch. */
    const sources = [
      request.signal,
      ...(requestContext?.requestLifecycle
        ? [requestContext.requestLifecycle.signal]
        : []),
    ];
    /** Propagate cooperative dispatch cancellation without freeing unsettled job capacity.
     * @returns {void} Abort notification completion.
     */
    const abort = () => controller.abort();
    for (const source of sources) {
      source.addEventListener('abort', abort, { once: true });
      if (source.aborted) {
        abort();
      }
    }
    controllers.add(controller);
    /** Whole-dispatch absolute deadline shared with schema/auth/store work. */
    const deadline = Date.now() + timeout;
    /** Owned cooperative dispatch deadline timer cleared after actual settlement. */
    const timer = setTimeout(abort, timeout);
    /** Recheck wall time and cooperative cancellation before protected dispatch stages.
     * @returns {void} Deadline validation completion.
     */
    const check = () => {
      if (Date.now() >= deadline) {
        controller.abort();
      }
      controller.signal.throwIfAborted();
    };
    /** Owned bounded validator HTTP reader; duplicate fields and files reject before action execution. */
    const adapter = createHttpInputAdapter({
      maxBytes,
      maxFields,
      maxFieldBytes: maxBytes,
      bodyTimeoutMs: Math.max(10, Math.min(timeout, 60000)),
      maxConcurrentReads: 1,
      duplicates: 'reject',
      files: 'reject',
      signal: controller.signal,
    });
    /** Actual action/auth/schema/persistence/invalidation settlement retained by registry close. */
    const job = (async () => {
      let claimed = false,
        committed = false,
        parsing = false;
      try {
        if (
          request.headers.has('content-length') &&
          (!/^\d+$/.test(request.headers.get('content-length')!) ||
            Number(request.headers.get('content-length')) > maxBytes)
        ) {
          return response(413, request);
        }
        if (request.method !== 'POST') {
          return response(405, request);
        }
        if (
          !isSameOriginRequest(
            request.headers.get('origin') ?? undefined,
            origin
          )
        ) {
          return response(403, request);
        }
        /** Normalized media type required to be URL-encoded form data. */
        const content = request.headers
          .get('content-type')
          ?.split(';')[0]!
          .trim()
          .toLowerCase();
        if (content !== 'application/x-www-form-urlencoded') {
          return response(415, request);
        }
        check();
        /** Fresh private host authentication result, never browser-supplied role claims. */
        const rawIdentity = await authenticate(request, requestContext);
        if (!rawIdentity) {
          return response(401, request);
        }
        /** Immutable validated host tenant/subject/session projection. */
        const who = principal(rawIdentity);
        check();
        parsing = true;
        /** Bounded parsed form fields with duplicate/file rejection. */
        const raw = await adapter.parseFormRequest(unknown(), request);
        parsing = false;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          return response(400, request);
        }
        /** Null-prototype submitted field projection after removing private action controls. */
        const fields = Object.assign(Object.create(null), raw) as Record<
          string,
          unknown
        >;
        /** Untrusted session CSRF token removed before schema validation. */
        const csrfValue = fields._action_csrf;
        /** Untrusted signed action key removed before schema validation. */
        const keyValue = fields._action_key;
        delete fields._action_csrf;
        delete fields._action_key;
        if (Object.keys(fields).length > maxFields - 2) {
          return response(413, request);
        }
        if (
          typeof csrfValue !== 'string' ||
          csrf.verify(csrfValue, who.sessionId) !== true
        ) {
          return response(403, request);
        }
        /** Verified signed principal-bound key expiry and durable record identity. */
        const verified = verify(keyValue, reference.ref, who);
        parsing = true;
        /** Independently validated schema output, canonicalized before authorization and claim hashing. */
        const input = await adapter.parseJsonRequest(
          entry.definition.schema,
          new Request(origin, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(fields),
            signal: controller.signal,
          })
        );
        parsing = false;
        /** Deeply frozen inert schema output shared by authorize/write callbacks. */
        const frozen = JSON.parse(canonical(input));
        /** Freeze only the already canonical plain JSON projection before protected callbacks run.
         * @param {unknown} value - Canonical inert JSON subtree.
         * @returns {void} Recursive immutable-input preparation completion.
         */
        const freeze = (value: any) => {
          if (value && typeof value === 'object') {
            for (const child of Object.values(value)) {
              freeze(child);
            }
            Object.freeze(value);
          }
        };
        freeze(frozen);
        /** Immutable fresh principal, signal and deadline projection for trusted action callbacks. */
        const context: ActionContext = Object.freeze({
          principal: who,
          signal: controller.signal,
          deadline,
        });
        if ((await entry.definition.authorize(frozen, context)) !== true) {
          return response(403, request);
        }
        check();
        /** Opaque principal/input-bound durable idempotency receipt with fresh ownership and expiry. */
        const claim: ActionClaim = Object.freeze({
          key: verified.key,
          digest: sign(
            'input',
            reference.ref,
            who.tenant,
            who.subject,
            canonical(frozen)
          ),
          owner: randomBytes(24).toString('base64url'),
          expiresAt: verified.expires + skew,
        });
        if (verified.expires <= Date.now()) {
          return response(409, request);
        }
        /** Minimum whole-dispatch/key-expiry deadline supplied to the persistent store. */
        const persistenceDeadline = Math.min(deadline, verified.expires);
        /** Durable principal-bound claim outcome; pending/conflicting work is never auto-replayed. */
        const result = await store.claim(
          claim,
          controller.signal,
          persistenceDeadline
        );
        if (result === 'conflict' || result === 'pending') {
          return response(409, request);
        }
        if (result !== 'claimed' && result !== 'committed') {
          throw new ApplicationError(503);
        }
        claimed = result === 'claimed';
        if (claimed) {
          await store.commit(
            claim,
            (tx) => entry.definition.write(tx, frozen, context),
            controller.signal,
            persistenceDeadline
          );
        }
        committed = true;
        // Confirmation survives caller cancellation. Invalidation is idempotent and may
        // be repeated by a committed replay after an outage; never replay the mutation.
        if (entry.definition.invalidate) {
          /** Independent postcommit invalidation cancellation owner; caller cancellation cannot undo a confirmed commit. */
          const after = new AbortController();
          /** Bounded postcommit invalidation deadline, separate from mutation persistence. */
          const afterDeadline = Date.now() + Math.min(timeout, 5000);
          /** Owned postcommit invalidation timer always removed after callback settlement. */
          const afterTimer = setTimeout(
            () => after.abort(),
            Math.min(timeout, 5000)
          );
          controllers.add(after);
          try {
            await entry.definition.invalidate(
              Object.freeze({
                ...context,
                signal: after.signal,
                deadline: afterDeadline,
              })
            );
          } finally {
            clearTimeout(afterTimer);
            after.abort();
            controllers.delete(after);
          }
        }
        return acceptsApiError(request.headers.get('accept'))
          ? Response.json(
              { ok: true, redirect: entry.definition.successRedirect },
              { headers: { 'cache-control': 'no-store', vary: 'Accept' } }
            )
          : new Response(null, {
              status: 303,
              headers: {
                location: entry.definition.successRedirect,
                'cache-control': 'no-store',
                vary: 'Accept',
              },
            });
      } catch (error) {
        if (claimed || committed) {
          return response(
            503,
            request,
            [],
            committed ? 'committed' : 'uncertain'
          );
        }
        if (parsing && error instanceof HttpValidationError) {
          return response(error.status, request, error.issues);
        }
        let status: number;
        if (controller.signal.aborted || Date.now() >= deadline) {
          status = 408;
        } else if (error instanceof ApplicationError) {
          status = error.status;
        } else {
          status = 503;
        }
        return response(status, request);
      } finally {
        clearTimeout(timer);
        controller.abort();
        await adapter.close();
        controllers.delete(controller);
        for (const source of sources) {
          source.removeEventListener('abort', abort);
        }
      }
    })();
    jobs.add(job);
    void job.finally(() => jobs.delete(job)).catch(() => {});
    return job;
  };
  /** Seal dispatch, abort observations, drain actual work and destroy only registry-owned signing material.
   * @returns {Promise<void>} Idempotent registry cleanup; borrowed auth/CSRF/store resources remain host-owned.
   */
  const close = () =>
    (closing ??= (async () => {
      closed = true;
      for (const controller of controllers) {
        controller.abort();
      }
      await Promise.allSettled([...jobs]);
      entries.clear();
      authenticator.destroy();
      key.fill(0);
    })());
  return {
    /** Capture trusted schema/authorization/database-write callbacks before dispatch seals the registry.
     * @param {string} name - Bounded stable authored action name.
     * @param {ActionDefinition<S, T>} definition - Trusted action policy and database-only write callback.
     * @returns {ActionReference<InferOutput<S>>} Immutable registry-local public reference; no server functions are serialized.
     */
    register<S extends GenericSchema | GenericSchemaAsync>(
      name: string,
      definition: ActionDefinition<S, T>
    ): ActionReference<InferOutput<S>> {
      if (
        closed ||
        sealed ||
        typeof name !== 'string' ||
        !/^[_a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name) ||
        !definition?.schema ||
        typeof definition.schema['~run'] !== 'function' ||
        typeof definition.authorize !== 'function' ||
        typeof definition.write !== 'function' ||
        (definition.invalidate !== undefined &&
          typeof definition.invalidate !== 'function') ||
        entries.size >= 128 ||
        (store.synchronous &&
          definition.write.constructor.name === 'AsyncFunction')
      ) {
        throw new TypeError('Invalid action registration');
      }
      /** Signed stable action name reference, not an executable function identifier from the browser. */
      const ref = sign('ref', name);
      if (entries.has(ref)) {
        throw new TypeError('Duplicate action');
      }
      /** Immutable registry-local reference containing only its public URL and signed identity. */
      const token = Object.freeze({ ref, url: `${prefix}/${ref}` });
      entries.set(ref, {
        token,
        definition: Object.freeze({
          ...definition,
          successRedirect: local(definition.successRedirect),
        }),
      });
      return token;
    },
    form: issue,
    handle,
    /** Attach protected native form routes once to a generation, rolling back partial registration and transferring close ownership.
     * @param {ZeruxPluginApi} api - Trusted generation plugin authority with explicit cleanup registration.
     * @returns {void} Route attachment completion; collisions or closed/sealed ownership reject.
     */
    attach(api: ZeruxPluginApi) {
      if (sealed || closed) {
        throw new TypeError('Action registry is sealed');
      }
      /** Explicit route-method collision checks before registering the protected ALL dispatcher. */
      const methods = [
        'ALL',
        'GET',
        'HEAD',
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
        'OPTIONS',
        'CONNECT',
        'TRACE',
      ];
      for (const { token } of entries.values()) {
        if (methods.some((method) => api.hasRoute(token.url, method))) {
          throw new TypeError('Action route conflict');
        }
      }
      /** Successfully registered action paths rolled back if attachment later fails. */
      const added: string[] = [];
      try {
        for (const { token } of entries.values()) {
          api.addRoute({
            pattern: token.url,
            method: 'ALL',
            handler: createFetchRoute((request, context) =>
              handle(token, request, context)
            ),
            meta: { streamBody: true },
          });
          added.push(token.url);
        }
        api.onDispose(close);
        sealed = true;
      } catch (error) {
        /** Attachment/rollback causes retained without skipping remaining route removals. */
        const errors = [error];
        for (const url of added.reverse()) {
          try {
            api.removeRoute(url, 'ALL');
          } catch (cleanup) {
            errors.push(cleanup);
          }
        }
        void close().catch(() => {});
        if (errors.length > 1) {
          throw new AggregateError(
            errors,
            'Action registration rollback failed'
          );
        }
        throw error;
      }
    },
    close,
    /** Count actual unsettled dispatches without action/principal labels.
     * @returns {number} Retained job count, including ignored cancellation until settlement.
     */
    get pending() {
      return jobs.size;
    },
  };
}
