import { createNonce } from './core.js';
import { hashData, type DigestAlgorithm } from './cryptography.js';
import { createSecurityHeaders, type SecureHeadersOptions } from './headers.js';

/** Supported structural CSP resource keys; unknown directives are not silently passed through. */
export const CSP_RESOURCE_DIRECTIVES = [
  'script-src',
  'style-src',
  'img-src',
  'font-src',
  'connect-src',
  'frame-src',
  'worker-src',
  'media-src',
  'manifest-src',
  'style-src-attr',
] as const;
export type CspResourceDirective = (typeof CSP_RESOURCE_DIRECTIVES)[number];
export interface CspHashSource {
  /** Explicit native SHA-2 algorithm selecting the exact digest byte length. */
  readonly hash: DigestAlgorithm;
  /** Canonical base64 digest text for the named hash algorithm. */
  readonly value: string;
}
export type CspSource = string | CspHashSource;
export type CspResources = Partial<
  Record<CspResourceDirective, readonly CspSource[]>
>;
export interface IsolationPolicy {
  /** Explicit opener isolation; defaults to same-origin. */
  coop?: 'same-origin' | 'same-origin-allow-popups' | 'unsafe-none';
  /** Explicit embedder isolation; defaults to require-corp. */
  coep?: 'require-corp' | 'credentialless' | 'unsafe-none';
  /** Explicit resource isolation; defaults to same-origin. */
  corp?: 'same-origin' | 'same-site' | 'cross-origin';
}
export interface ModuleSecurityRequirements {
  /** Public owning module label; do not place secrets or personal data here. */
  readonly module: string;
  /** Declared exact resource requirements, separately subject to host approval. */
  readonly resources?: CspResources;
  /** Optional exact module isolation requirements; conflicting values reject. */
  readonly isolation?: IsolationPolicy;
  /** Require script-src nonce support; host disablement yields an explicit conflict. */
  readonly requiresNonce?: boolean;
}
export interface SecurityPolicyOptions extends IsolationPolicy {
  /** Production default; development allowances require explicit trusted selection. */
  mode?: 'production' | 'development';
  /** Trusted transport fact gating HSTS; never infer blindly from forwarding headers. */
  https?: boolean;
  /** Explicit validated host HSTS policy; production defaults on for trusted HTTPS. */
  hsts?: SecureHeadersOptions['hsts'];
  /** Host base policy; 'none' is an explicit prohibition, not a merge wildcard. */
  resources?: CspResources;
  /** Bounded explicit module declarations; no automatic package execution. */
  modules?: readonly ModuleSecurityRequirements[];
  /** Exact per-module approvals; wildcard origins/schemes/paths are unsupported. */
  approvals?: Readonly<Record<string, CspResources>>;
  /** Host-only exact framing policy; defaults to none. */
  frameAncestors?: readonly string[];
  /** Explicit development-only override of ancestor policy. Never inferred from a request. */
  developmentFrameAncestors?: readonly string[];
  /** Explicit script-src/style-src nonce choices; defaults to script-src. */
  nonceDirectives?: readonly ('script-src' | 'style-src')[];
}
export interface PolicyConflict {
  /** Public owning module label; do not place secrets or personal data here. */
  readonly module: string;
  /** Fixed public directive identifier for a conflict. */
  readonly directive: string;
  /** Fixed redacted conflict reason, without requested source contents. */
  readonly reason: string;
}
/** Immutable redacted composition failure; no module can silently weaken host policy. */
export class SecurityPolicyConflictError extends Error {
  /** Frozen fixed module/directive/reason records; requested private sources are excluded. */
  readonly conflicts: readonly PolicyConflict[];
  /** Report immutable redacted policy conflicts rather than silently weakening host requirements.
   * @param {readonly PolicyConflict[]} conflicts - Fixed public module/directive/reason entries; do not include private source values.
   */
  constructor(conflicts: readonly PolicyConflict[]) {
    super('Security policy requirements conflict with host approvals');
    this.name = 'SecurityPolicyConflictError';
    this.conflicts = Object.freeze(
      conflicts.map((conflict) => Object.freeze({ ...conflict }))
    );
  }
}
/** Existing control/whitespace rejection grammar for exact configured origin tokens. */
// eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
const control = /[\x00-\x20\x7f]/;
/** Require a nonarray configuration object; this helper is structural validation, not a JavaScript sandbox.
 * @param {unknown} value - Host policy candidate.
 * @param {string} label - Fixed public diagnostic label.
 * @returns {void} Completes only for an object candidate; malformed shape throws.
 */
function object(
  value: unknown,
  label: string
): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Invalid ${label}`);
  }
}
/** Require a bounded explicit array before processing sources/modules.
 * @param {unknown} value - Host list candidate; at most64 entries.
 * @returns {void} Completes only for an array within the structural budget.
 */
function list(value: unknown): asserts value is readonly any[] {
  if (!Array.isArray(value) || value.length > 64) {
    throw new TypeError('Policy lists support at most 64 entries');
  }
}
/** Validate an exact canonical CSP origin under the trusted mode and directive capability.
 * @param {unknown} value - Candidate exact origin; wildcards, credentials, paths and controls reject.
 * @param {string} mode - Trusted production/development mode; production permits HTTPS and explicit connect WSS.
 * @param {boolean} connect - Allow connect-specific WebSocket origins only when true.
 * @returns {string} Validated exact permitted origin; no URL is fetched.
 */
function origin(value: unknown, mode: string, connect = false): string {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    control.test(value) ||
    value.includes('*')
  ) {
    throw new TypeError('Invalid policy origin');
  }
  try {
    /** Parsed candidate origin; only exact permitted scheme/origin forms are accepted. */
    const url = new URL(value);
    /** Explicit production/development protocol policy; request forwarding headers cannot widen it. */
    const protocols =
      mode === 'development'
        ? ['http:', 'https:', ...(connect ? ['ws:', 'wss:'] : [])]
        : ['https:', ...(connect ? ['wss:'] : [])];
    if (
      !protocols.includes(url.protocol) ||
      url.origin !== value ||
      url.username ||
      url.password
    ) {
      throw new Error();
    }
    return value;
  } catch {
    throw new TypeError('Policy sources must be exact permitted origins');
  }
}
/** Validate explicit response-owner nonce syntax and canonical byte length. Syntax cannot prove entropy or authorize a principal.
 * @param {unknown} value - Host-provided canonical base64 nonce with16–64 decoded bytes.
 * @returns {void} Completes only for a canonical supported nonce shape.
 */
export function assertSecurityNonce(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length > 88 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new TypeError('Invalid security nonce');
  }
  /** Decoded nonce bytes checked for canonical base64 and native entropy-size compatibility. */
  const bytes = Buffer.from(value, 'base64');
  if (
    bytes.length < 16 ||
    bytes.length > 64 ||
    bytes.toString('base64') !== value
  ) {
    throw new TypeError('Invalid security nonce');
  }
}
/** Hash exact trusted inline text/bytes for structural CSP; whitespace changes the descriptor and no content is executed.
 * @param {string | Uint8Array} content - Exact trusted inline source under the native digest budget.
 * @param {DigestAlgorithm} hash - Explicit supported SHA-2 algorithm; defaults sha256.
 * @returns {CspHashSource} Frozen native digest descriptor, not a permission grant.
 */
export function createCspHash(
  content: string | Uint8Array,
  hash: DigestAlgorithm = 'sha256'
): CspHashSource {
  return Object.freeze({
    hash,
    value: Buffer.from(hashData(content, hash), 'hex').toString('base64'),
  });
}
/** Validate one resource source under explicit directive/mode/host ownership rules.
 * @param {unknown} value - Exact origin, supported keyword or native hash descriptor.
 * @param {CspResourceDirective} directive - Allowlisted resource directive receiving the source.
 * @param {string} mode - Trusted production/development policy.
 * @param {boolean} module - Whether a module requests the source; modules cannot enable host-only unsafe-inline.
 * @returns {string} Canonical permitted source token; unsupported values throw.
 */
function source(
  value: unknown,
  directive: CspResourceDirective,
  mode: string,
  module = false
): string {
  if (typeof value === 'object' && value !== null) {
    object(value, 'CSP hash');
    if (
      Object.keys(value).some((key) => !['hash', 'value'].includes(key)) ||
      !['script-src', 'style-src'].includes(directive) ||
      !['sha256', 'sha384', 'sha512'].includes(value.hash as string) ||
      typeof value.value !== 'string' ||
      value.value.length > 88 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value.value)
    ) {
      throw new TypeError('Invalid CSP hash source');
    }
    /** Decoded fixed-algorithm hash bytes; canonical size/encoding must match the descriptor. */
    const digest = Buffer.from(value.value, 'base64');
    if (
      digest.length !==
        { sha256: 32, sha384: 48, sha512: 64 }[value.hash as DigestAlgorithm] ||
      digest.toString('base64') !== value.value
    ) {
      throw new TypeError('Invalid CSP hash source');
    }
    return `'${value.hash}-${value.value}'`;
  }
  if (value === "'self'" || value === "'none'") {
    return value;
  }
  if (
    value === "'unsafe-inline'" &&
    mode === 'development' &&
    !module &&
    ['style-src', 'style-src-attr'].includes(directive)
  ) {
    return value;
  }
  if (value === 'data:' && ['img-src', 'font-src'].includes(directive)) {
    return value;
  }
  return origin(value, mode, directive === 'connect-src');
}
/** Capture independent validated directive sets; explicit none remains a prohibition, not a merge wildcard.
 * @param {unknown} value - Optional host/module resource map.
 * @param {string} mode - Trusted application mode.
 * @param {boolean} module - Whether module restrictions rather than host allowances apply.
 * @returns {Map<CspResourceDirective, Set<string>>} New validated source sets; an empty source list becomes explicit none.
 */
function resources(
  value: unknown,
  mode: string,
  module = false
): Map<CspResourceDirective, Set<string>> {
  /** Independent directive/source sets captured before per-response serialization. */
  const result = new Map<CspResourceDirective, Set<string>>();
  if (value === undefined) {
    return result;
  }
  object(value, 'CSP resources');
  // Validate deterministic supported directives before source composition.
  for (const key of Object.keys(value).sort()) {
    if (!(CSP_RESOURCE_DIRECTIVES as readonly string[]).includes(key)) {
      throw new TypeError('Unsupported CSP resource directive');
    }
    /** Bounded explicit source list for one allowlisted resource directive. */
    const items = value[key];
    list(items);
    /** Independent canonical source set; none cannot coexist with other allowances. */
    const values = new Set(
      items.map((item) =>
        source(item, key as CspResourceDirective, mode, module)
      )
    );
    if (values.has("'none'") && values.size > 1) {
      throw new TypeError('CSP none cannot be combined with sources');
    }
    result.set(
      key as CspResourceDirective,
      values.size ? values : new Set(["'none'"])
    );
  }
  return result;
}
/** Resolve validated isolation defaults without permitting untrusted module negotiation to weaken the host.
 * @param {IsolationPolicy} value - Trusted host policy or explicit module requirement.
 * @returns {Required<IsolationPolicy>} Resolved COOP/COEP/CORP values; unknown choices throw.
 */
function isolation(value: IsolationPolicy): Required<IsolationPolicy> {
  /** Resolved explicit opener/embedder/resource isolation policy; modules cannot negotiate it weaker. */
  const policy = {
    coop: value.coop ?? 'same-origin',
    coep: value.coep ?? 'require-corp',
    corp: value.corp ?? 'same-origin',
  };
  if (
    !['same-origin', 'same-origin-allow-popups', 'unsafe-none'].includes(
      policy.coop
    ) ||
    !['require-corp', 'credentialless', 'unsafe-none'].includes(policy.coep) ||
    !['same-origin', 'same-site', 'cross-origin'].includes(policy.corp)
  ) {
    throw new TypeError('Invalid cross-origin isolation policy');
  }
  return policy;
}
/** Validate/deduplicate/sort exact framing ancestors; none cannot coexist with another source.
 * @param {unknown} value - Nonempty bounded exact ancestor list.
 * @param {string} mode - Trusted mode deciding permitted origin schemes.
 * @returns {string[]} Canonical framing policy for header serialization.
 */
function ancestors(value: unknown, mode: string): string[] {
  list(value);
  /** Independent canonical source set; none cannot coexist with other allowances. */
  const values = [
    ...new Set(
      value.map((item) =>
        item === "'self'" || item === "'none'" ? item : origin(item, mode)
      )
    ),
  ].sort();
  if (!values.length || (values.includes("'none'") && values.length > 1)) {
    throw new TypeError('Invalid frame ancestor policy');
  }
  return values;
}

/** Snapshot trusted host policy and module declarations before any response. No request/header inputs, nonce generation, service registration or I/O occurs here.
 * @param {SecurityPolicyOptions} options - Explicit bounded host resources, approvals, framing, transport and isolation policy.
 * @returns {object} Frozen inert composer; createResponse owns fresh per-response nonce generation.
 */
export function createSecurityPolicy(options: SecurityPolicyOptions = {}) {
  object(options, 'security policy');
  if (
    Object.keys(options).some(
      (key) =>
        ![
          'mode',
          'https',
          'hsts',
          'resources',
          'modules',
          'approvals',
          'frameAncestors',
          'developmentFrameAncestors',
          'nonceDirectives',
          'coop',
          'coep',
          'corp',
        ].includes(key)
    )
  ) {
    throw new TypeError('Unknown security policy option');
  }
  /** Trusted production/development selection, default production; never taken from a request. */
  const mode = options.mode ?? 'production';
  if (!['production', 'development'].includes(mode)) {
    throw new TypeError('Invalid security policy mode');
  }
  if (options.https !== undefined && typeof options.https !== 'boolean') {
    throw new TypeError('Invalid HTTPS policy');
  }
  if (
    options.developmentFrameAncestors !== undefined &&
    mode !== 'development'
  ) {
    throw new TypeError(
      'Development framing is prohibited in production policy'
    );
  }
  /** Captured host isolation requirements against which modules are checked. */
  const hostIsolation = isolation(options);
  /** Host resource policy under composition; explicit none remains a hard prohibition. */
  const baseline = resources(
    {
      'script-src': ["'self'"],
      'style-src': ["'self'"],
      'img-src': ["'self'"],
      'font-src': ["'self'"],
      'connect-src': ["'self'"],
      'frame-src': ["'none'"],
      'worker-src': ["'self'"],
      'media-src': ["'self'"],
      'manifest-src': ["'self'"],
      'style-src-attr': ["'none'"],
    },
    mode
  );
  /** Original explicit host resource approvals, separate from other modules’ accumulated allowances. */
  const hostResources = resources(options.resources, mode);
  // Explicit host values replace defaults; none remains a hard prohibition.
  for (const [key, values] of hostResources) {
    baseline.set(key, new Set(values));
  }
  let frameAncestors = ancestors(options.frameAncestors ?? ["'none'"], mode);
  if (options.developmentFrameAncestors !== undefined) {
    list(options.developmentFrameAncestors);
    frameAncestors = ancestors(
      ["'self'", ...options.developmentFrameAncestors],
      mode
    );
  }
  /** Bounded explicit nonce directive choices; defaults to script-src only. */
  const nonceDirectives = options.nonceDirectives ?? ['script-src'];
  list(nonceDirectives);
  if (
    nonceDirectives.some(
      (value) => !['script-src', 'style-src'].includes(value)
    )
  ) {
    throw new TypeError('Invalid nonce directive');
  }
  /** Distinct sorted nonce targets captured once for deterministic response policy. */
  const nonceTargets = [...new Set(nonceDirectives)].sort();
  /** Exact per-module grants; approval for one module never authorizes another. */
  const approvals = new Map<string, Map<CspResourceDirective, Set<string>>>();
  if (options.approvals !== undefined) {
    object(options.approvals, 'module approvals');
    if (Object.keys(options.approvals).length > 64) {
      throw new TypeError('Too many module approvals');
    }
    // Capture each module grant independently; one module’s allowance cannot authorize another.
    for (const [id, value] of Object.entries(options.approvals)) {
      approvals.set(id, resources(value, mode));
    }
  }
  /** Bounded trusted module declarations; no package scanning or request-supplied code. */
  const requests = options.modules ?? [];
  list(requests);
  /** Unique public module IDs; duplicate or prototype-sensitive labels reject. */
  const ids = new Set<string>();
  /** Fixed module/directive/reason diagnostics; source URLs and secrets are excluded. */
  const conflicts: PolicyConflict[] = [];
  // Sort before merging so diagnostics and directives do not depend on registration order.
  for (const request of [...requests].sort((a, b) => {
    if (a?.module < b?.module) {
      return -1;
    }
    if (a?.module > b?.module) {
      return 1;
    }
    return 0;
  })) {
    object(request, 'module requirement');
    if (
      Object.keys(request).some(
        (key) =>
          !['module', 'resources', 'isolation', 'requiresNonce'].includes(key)
      )
    ) {
      throw new TypeError('Unknown module requirement');
    }
    /** Validated public module label used only for deterministic grant/conflict association. */
    const id = request.module;
    if (
      typeof id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id) ||
      ['__proto__', 'constructor', 'prototype'].includes(id) ||
      ids.has(id)
    ) {
      throw new TypeError('Invalid or duplicate policy module');
    }
    ids.add(id);
    if (
      request.requiresNonce !== undefined &&
      typeof request.requiresNonce !== 'boolean'
    ) {
      throw new TypeError('Invalid module nonce requirement');
    }
    if (request.requiresNonce && !nonceTargets.includes('script-src')) {
      conflicts.push({
        module: id,
        directive: 'script-src',
        reason: 'nonce-disabled',
      });
    }
    if (request.isolation !== undefined) {
      object(request.isolation, 'module isolation');
      if (
        Object.keys(request.isolation).some(
          (key) => !['coop', 'coep', 'corp'].includes(key)
        )
      ) {
        throw new TypeError('Unknown module isolation requirement');
      }
      isolation(request.isolation);
      // A module may require matching isolation but may not negotiate a weaker host setting.
      for (const name of ['coop', 'coep', 'corp'] as const) {
        if (
          request.isolation[name] !== undefined &&
          request.isolation[name] !== hostIsolation[name]
        ) {
          conflicts.push({
            module: id,
            directive: name,
            reason: 'isolation-mismatch',
          });
        }
      }
    }
    // Check each module requirement only against original host policy and that module’s exact approvals.
    for (const [directive, values] of resources(
      request.resources,
      mode,
      true
    )) {
      /** Captured effective host directive set; modules may not remove its explicit prohibitions. */
      const host = baseline.get(directive)!;
      // Deterministically validate source grants and collect conflicts without reflecting source values.
      for (const token of [...values].sort()) {
        // Approvals are checked against the original host policy, never another module's grant.
        /** Original host allowance for this directive, without another module’s grants. */
        const explicit = hostResources.get(directive);
        /** Whether this exact source was approved by the original host policy. */
        const originallyAllowed =
          explicit?.has(token) ?? (token === "'self'" && !host.has("'none'"));
        if (host.has("'none'") && token !== "'none'") {
          conflicts.push({
            module: id,
            directive,
            reason: 'host-denies-directive',
          });
        } else if (token === "'none'" && !host.has(token)) {
          conflicts.push({
            module: id,
            directive,
            reason: 'incompatible-denial',
          });
        } else if (
          !originallyAllowed &&
          !host.has("'none'") &&
          !approvals.get(id)?.get(directive)?.has(token)
        ) {
          conflicts.push({
            module: id,
            directive,
            reason: 'source-not-approved',
          });
        } else {
          host.add(token);
        }
        if (host.size > 64) {
          throw new RangeError('Too many composed CSP sources');
        }
      }
    }
  }
  // Explicit none cannot coexist with a per-response nonce allowance.
  for (const directive of nonceTargets) {
    if (baseline.get(directive)!.has("'none'")) {
      conflicts.push({
        module: 'host',
        directive,
        reason: 'nonce-with-denial',
      });
    }
  }
  if (conflicts.length) {
    throw new SecurityPolicyConflictError(conflicts);
  }
  /** Validated captured response headers; HTTPS/HSTS and isolation remain host decisions. */
  const headerBase = createSecurityHeaders(
    {
      hsts: options.hsts ?? mode === 'production',
      crossOriginOpenerPolicy: hostIsolation.coop,
      crossOriginEmbedderPolicy: hostIsolation.coep,
      crossOriginResourcePolicy: hostIsolation.corp,
    },
    options.https ?? false
  );
  if (frameAncestors.length === 1 && frameAncestors[0] === "'none'") {
    headerBase['x-frame-options'] = 'DENY';
  } else if (frameAncestors.length === 1 && frameAncestors[0] === "'self'") {
    headerBase['x-frame-options'] = 'SAMEORIGIN';
  } else {
    delete headerBase['x-frame-options'];
  } // XFO cannot express an exact external origin allowlist.
  /** Complete deterministic directive snapshot before response-owned nonce insertion. */
  const directives = new Map<string, readonly string[]>([
    ['default-src', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['object-src', ["'none'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', frameAncestors],
  ]);
  // Capture sorted per-directive values before response-owned nonce insertion.
  for (const [key, values] of baseline) {
    directives.set(key, [...values].sort());
  }
  if (
    [...directives].reduce(
      (size, [key, values]) => size + key.length + values.join(' ').length + 3,
      200
    ) > 16384
  ) {
    throw new RangeError('Composed CSP exceeds header limit');
  }
  return Object.freeze({
    /** Create exactly once before committing a response’s headers or first stream chunk. Share this nonce only with that response’s trusted renderers.
     * @returns {object} Frozen response headers and optional fresh native nonce; randomness failures propagate without fallback.
     */
    createResponse() {
      /** Fresh per-response native nonce; shared across that response’s trusted renderer chunks only. */
      const nonce = nonceTargets.length ? createNonce() : undefined;
      /** Sorted serialized directive clauses; source order is deterministic except the fresh nonce. */
      const parts = [...directives]
        .sort(([a], [b]) => {
          if (a < b) {
            return -1;
          }
          if (a > b) {
            return 1;
          }
          return 0;
        })
        .map(([key, values]) => {
          /** Per-response copy; inserting a nonce never mutates the captured shared policy. */
          const sources = [...values];
          if (
            nonce &&
            nonceTargets.includes(key as 'script-src' | 'style-src')
          ) {
            sources.push(`'nonce-${nonce}'`);
          }
          return `${key} ${sources.sort().join(' ')}`;
        });
      /** Complete composed header, checked again against the16-KiB serialization ceiling. */
      const csp = parts.join('; ');
      if (csp.length > 16384) {
        throw new RangeError('Composed CSP exceeds header limit');
      }
      return Object.freeze({
        nonce,
        headers: Object.freeze({
          ...headerBase,
          'content-security-policy': csp,
        }),
      });
    },
  });
}
