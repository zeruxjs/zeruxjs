import { createNonce } from './core.js';
import { hashData, type DigestAlgorithm } from './cryptography.js';
import { createSecurityHeaders, type SecureHeadersOptions } from './headers.js';

export const CSP_RESOURCE_DIRECTIVES = ['script-src', 'style-src', 'img-src', 'font-src', 'connect-src', 'frame-src', 'worker-src', 'media-src', 'manifest-src', 'style-src-attr'] as const;
export type CspResourceDirective = typeof CSP_RESOURCE_DIRECTIVES[number];
export interface CspHashSource { readonly hash: DigestAlgorithm; readonly value: string }
export type CspSource = string | CspHashSource;
export type CspResources = Partial<Record<CspResourceDirective, readonly CspSource[]>>;
export interface IsolationPolicy {
    coop?: 'same-origin' | 'same-origin-allow-popups' | 'unsafe-none';
    coep?: 'require-corp' | 'credentialless' | 'unsafe-none';
    corp?: 'same-origin' | 'same-site' | 'cross-origin';
}
export interface ModuleSecurityRequirements {
    readonly module: string;
    readonly resources?: CspResources;
    readonly isolation?: IsolationPolicy;
    readonly requiresNonce?: boolean;
}
export interface SecurityPolicyOptions extends IsolationPolicy {
    mode?: 'production' | 'development';
    https?: boolean;
    hsts?: SecureHeadersOptions['hsts'];
    /** Host base policy; 'none' is an explicit prohibition, not a merge wildcard. */
    resources?: CspResources;
    modules?: readonly ModuleSecurityRequirements[];
    /** Exact per-module approvals; wildcard origins/schemes/paths are unsupported. */
    approvals?: Readonly<Record<string, CspResources>>;
    frameAncestors?: readonly string[];
    /** Explicit development-only override of ancestor policy. Never inferred from a request. */
    developmentFrameAncestors?: readonly string[];
    nonceDirectives?: readonly ('script-src' | 'style-src')[];
}
export interface PolicyConflict { readonly module: string; readonly directive: string; readonly reason: string }
export class SecurityPolicyConflictError extends Error {
    readonly conflicts: readonly PolicyConflict[];
    constructor(conflicts: readonly PolicyConflict[]) {
        super('Security policy requirements conflict with host approvals');
        this.name = 'SecurityPolicyConflictError';
        this.conflicts = Object.freeze(conflicts.map(conflict => Object.freeze({ ...conflict })));
    }
}
const control = /[\x00-\x20\x7f]/;
function object(value: unknown, label: string): asserts value is Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Invalid ${label}`);
}
function list(value: unknown): asserts value is readonly any[] {
    if (!Array.isArray(value) || value.length > 64) throw new TypeError('Policy lists support at most 64 entries');
}
function origin(value: unknown, mode: string, connect = false): string {
    if (typeof value !== 'string' || value.length > 2048 || control.test(value) || value.includes('*')) throw new TypeError('Invalid policy origin');
    try {
        const url = new URL(value);
        const protocols = mode === 'development' ? ['http:', 'https:', ...(connect ? ['ws:', 'wss:'] : [])] : ['https:', ...(connect ? ['wss:'] : [])];
        if (!protocols.includes(url.protocol) || url.origin !== value || url.username || url.password) throw new Error();
        return value;
    } catch { throw new TypeError('Policy sources must be exact permitted origins'); }
}
/** Validate explicit owner-provided nonces. Syntax is not an entropy guarantee. */
export function assertSecurityNonce(value: unknown): asserts value is string {
    if (typeof value !== 'string' || value.length > 88 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new TypeError('Invalid security nonce');
    const bytes = Buffer.from(value, 'base64');
    if (bytes.length < 16 || bytes.length > 64 || bytes.toString('base64') !== value) throw new TypeError('Invalid security nonce');
}
/** Hash exact trusted inline text/bytes; changes in whitespace change the source. */
export function createCspHash(content: string | Uint8Array, hash: DigestAlgorithm = 'sha256'): CspHashSource {
    return Object.freeze({ hash, value: Buffer.from(hashData(content, hash), 'hex').toString('base64') });
}
function source(value: unknown, directive: CspResourceDirective, mode: string, module = false): string {
    if (typeof value === 'object' && value !== null) {
        object(value, 'CSP hash');
        if (Object.keys(value).some(key => !['hash', 'value'].includes(key)) || !['script-src', 'style-src'].includes(directive) || !['sha256', 'sha384', 'sha512'].includes(value.hash as string) || typeof value.value !== 'string' || value.value.length > 88 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.value)) throw new TypeError('Invalid CSP hash source');
        const digest = Buffer.from(value.value, 'base64');
        if (digest.length !== ({ sha256: 32, sha384: 48, sha512: 64 }[value.hash as DigestAlgorithm]) || digest.toString('base64') !== value.value) throw new TypeError('Invalid CSP hash source');
        return `'${value.hash}-${value.value}'`;
    }
    if (value === "'self'" || value === "'none'") return value;
    if (value === "'unsafe-inline'" && mode === 'development' && !module && ['style-src', 'style-src-attr'].includes(directive)) return value;
    if (value === 'data:' && ['img-src', 'font-src'].includes(directive)) return value;
    return origin(value, mode, directive === 'connect-src');
}
function resources(value: unknown, mode: string, module = false): Map<CspResourceDirective, Set<string>> {
    const result = new Map<CspResourceDirective, Set<string>>();
    if (value === undefined) return result;
    object(value, 'CSP resources');
    for (const key of Object.keys(value).sort()) {
        if (!(CSP_RESOURCE_DIRECTIVES as readonly string[]).includes(key)) throw new TypeError('Unsupported CSP resource directive');
        const items = value[key]; list(items);
        const values = new Set(items.map(item => source(item, key as CspResourceDirective, mode, module)));
        if (values.has("'none'") && values.size > 1) throw new TypeError('CSP none cannot be combined with sources');
        result.set(key as CspResourceDirective, values.size ? values : new Set(["'none'"]));
    }
    return result;
}
function isolation(value: IsolationPolicy): Required<IsolationPolicy> {
    const policy = { coop: value.coop ?? 'same-origin', coep: value.coep ?? 'require-corp', corp: value.corp ?? 'same-origin' };
    if (!['same-origin', 'same-origin-allow-popups', 'unsafe-none'].includes(policy.coop) || !['require-corp', 'credentialless', 'unsafe-none'].includes(policy.coep) || !['same-origin', 'same-site', 'cross-origin'].includes(policy.corp)) throw new TypeError('Invalid cross-origin isolation policy');
    return policy;
}
function ancestors(value: unknown, mode: string): string[] {
    list(value);
    const values = [...new Set(value.map(item => item === "'self'" || item === "'none'" ? item : origin(item, mode)))].sort();
    if (!values.length || (values.includes("'none'") && values.length > 1)) throw new TypeError('Invalid frame ancestor policy');
    return values;
}

/** Snapshot trusted application policy and module declarations. No request/header
 * inputs, mutable global registry, random nonce, I/O or service starts here.
 */
export function createSecurityPolicy(options: SecurityPolicyOptions = {}) {
    object(options, 'security policy');
    if (Object.keys(options).some(key => !['mode', 'https', 'hsts', 'resources', 'modules', 'approvals', 'frameAncestors', 'developmentFrameAncestors', 'nonceDirectives', 'coop', 'coep', 'corp'].includes(key))) throw new TypeError('Unknown security policy option');
    const mode = options.mode ?? 'production';
    if (!['production', 'development'].includes(mode)) throw new TypeError('Invalid security policy mode');
    if (options.https !== undefined && typeof options.https !== 'boolean') throw new TypeError('Invalid HTTPS policy');
    if (options.developmentFrameAncestors !== undefined && mode !== 'development') throw new TypeError('Development framing is prohibited in production policy');
    const hostIsolation = isolation(options);
    const baseline = resources({
        'script-src': ["'self'"], 'style-src': ["'self'"], 'img-src': ["'self'"], 'font-src': ["'self'"],
        'connect-src': ["'self'"], 'frame-src': ["'none'"], 'worker-src': ["'self'"], 'media-src': ["'self'"], 'manifest-src': ["'self'"], 'style-src-attr': ["'none'"]
    }, mode);
    const hostResources = resources(options.resources, mode);
    for (const [key, values] of hostResources) baseline.set(key, new Set(values));
    let frameAncestors = ancestors(options.frameAncestors ?? ["'none'"], mode);
    if (options.developmentFrameAncestors !== undefined) {
        list(options.developmentFrameAncestors);
        frameAncestors = ancestors(["'self'", ...options.developmentFrameAncestors], mode);
    }
    const nonceDirectives = options.nonceDirectives ?? ['script-src']; list(nonceDirectives);
    if (nonceDirectives.some(value => !['script-src', 'style-src'].includes(value))) throw new TypeError('Invalid nonce directive');
    const nonceTargets = [...new Set(nonceDirectives)].sort();
    const approvals = new Map<string, Map<CspResourceDirective, Set<string>>>();
    if (options.approvals !== undefined) {
        object(options.approvals, 'module approvals');
        if (Object.keys(options.approvals).length > 64) throw new TypeError('Too many module approvals');
        for (const [id, value] of Object.entries(options.approvals)) approvals.set(id, resources(value, mode));
    }
    const requests = options.modules ?? []; list(requests);
    const ids = new Set<string>(); const conflicts: PolicyConflict[] = [];
    // Sort before merging so diagnostics and directives do not depend on registration order.
    for (const request of [...requests].sort((a, b) => a?.module < b?.module ? -1 : a?.module > b?.module ? 1 : 0)) {
        object(request, 'module requirement');
        if (Object.keys(request).some(key => !['module', 'resources', 'isolation', 'requiresNonce'].includes(key))) throw new TypeError('Unknown module requirement');
        const id = request.module;
        if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id) || ids.has(id)) throw new TypeError('Invalid or duplicate policy module');
        ids.add(id);
        if (request.requiresNonce !== undefined && typeof request.requiresNonce !== 'boolean') throw new TypeError('Invalid module nonce requirement');
        if (request.requiresNonce && !nonceTargets.includes('script-src')) conflicts.push({ module: id, directive: 'script-src', reason: 'nonce-disabled' });
        if (request.isolation !== undefined) {
            object(request.isolation, 'module isolation');
            if (Object.keys(request.isolation).some(key => !['coop', 'coep', 'corp'].includes(key))) throw new TypeError('Unknown module isolation requirement');
            isolation(request.isolation);
            for (const name of ['coop', 'coep', 'corp'] as const) if (request.isolation[name] !== undefined && request.isolation[name] !== hostIsolation[name]) conflicts.push({ module: id, directive: name, reason: 'isolation-mismatch' });
        }
        for (const [directive, values] of resources(request.resources, mode, true)) {
            const host = baseline.get(directive)!;
            for (const token of [...values].sort()) {
                // Approvals are checked against the original host policy, never another module's grant.
                const explicit = hostResources.get(directive);
                const originallyAllowed = explicit?.has(token) ?? (token === "'self'" && !host.has("'none'"));
                if (host.has("'none'") && token !== "'none'") conflicts.push({ module: id, directive, reason: 'host-denies-directive' });
                else if (token === "'none'" && !host.has(token)) conflicts.push({ module: id, directive, reason: 'incompatible-denial' });
                else if (!originallyAllowed && !host.has("'none'") && !approvals.get(id)?.get(directive)?.has(token)) conflicts.push({ module: id, directive, reason: 'source-not-approved' });
                else host.add(token);
                if (host.size > 64) throw new RangeError('Too many composed CSP sources');
            }
        }
    }
    for (const directive of nonceTargets) if (baseline.get(directive)!.has("'none'")) conflicts.push({ module: 'host', directive, reason: 'nonce-with-denial' });
    if (conflicts.length) throw new SecurityPolicyConflictError(conflicts);
    const headerBase = createSecurityHeaders({ hsts: options.hsts ?? (mode === 'production'), crossOriginOpenerPolicy: hostIsolation.coop, crossOriginEmbedderPolicy: hostIsolation.coep, crossOriginResourcePolicy: hostIsolation.corp }, options.https ?? false);
    if (frameAncestors.length === 1 && frameAncestors[0] === "'none'") headerBase['x-frame-options'] = 'DENY';
    else if (frameAncestors.length === 1 && frameAncestors[0] === "'self'") headerBase['x-frame-options'] = 'SAMEORIGIN';
    else delete headerBase['x-frame-options']; // XFO cannot express an exact external origin allowlist.
    const directives = new Map<string, readonly string[]>([
        ['default-src', ["'none'"]], ['base-uri', ["'none'"]], ['object-src', ["'none'"]], ['form-action', ["'self'"]], ['frame-ancestors', frameAncestors]
    ]);
    for (const [key, values] of baseline) directives.set(key, [...values].sort());
    if ([...directives].reduce((size, [key, values]) => size + key.length + values.join(' ').length + 3, 200) > 16384) throw new RangeError('Composed CSP exceeds header limit');
    return Object.freeze({
        /** Create exactly once before response headers/first stream chunk. Pass its
         * nonce to every trusted renderer for that response; never infer it from input.
         */
        createResponse() {
            const nonce = nonceTargets.length ? createNonce() : undefined;
            const parts = [...directives].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, values]) => {
                const sources = [...values];
                if (nonce && nonceTargets.includes(key as 'script-src' | 'style-src')) sources.push(`'nonce-${nonce}'`);
                return `${key} ${sources.sort().join(' ')}`;
            });
            const csp = parts.join('; ');
            if (csp.length > 16384) throw new RangeError('Composed CSP exceeds header limit');
            return Object.freeze({ nonce, headers: Object.freeze({ ...headerBase, 'content-security-policy': csp }) });
        }
    });
}
