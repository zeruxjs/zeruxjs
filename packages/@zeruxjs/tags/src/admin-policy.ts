export interface TagAdminAuditEvent {
  /** Audit schema version, currently V1. */
  version: 1;
  /** Unique transition identifier linking intent and terminal audit receipts. */
  operationId: string;
  /** Intent precedes mutation; committed/conflict describe the observed CAS outcome. */
  phase: 'intent' | 'committed' | 'conflict';
  /** Explicit publish or rollback transition; draft editing stays separate. */
  action: 'publish' | 'rollback';
  /** Opaque host-verified tenant label, never inferred from stored public content. */
  tenant: string;
  /** Opaque host-verified initiating actor; no recipient address or private traits. */
  actor: string;
  /** UTC epoch milliseconds for this audit phase. */
  at: number;
  /** Optimistic draft revision required by the requested transition. */
  expectedVersion: number;
  /** Optional retained published release selected for rollback. */
  releaseId?: number;
  /** Optional committed resulting revision; absent does not prove no write. */
  revision?: number;
  /** SHA-256 of the transition definition; integrity does not prove authorship. */
  definitionHash: string;
}
export interface TagAdminMount {
  /** Independent API route prefix and UI page; defaults retain /<prefix>/admin. */
  basePath?: string;
  /** Optional authenticated HTML mount independent of API prefix. */
  uiPath?: string;
  /** False disables the built-in page; host owns a separately deployed UI. */
  serveUi?: boolean;
  /** Optional explicit API origin; never inferred from the UI asset origin. */
  publicOrigin?: string;
  /** At most 16 exact UI origins; cross-origin writes require host CSRF verification. */
  allowedOrigins?: readonly string[];
  /** Actual in-flight admin work ceiling, default 8, maximum 64. */
  maxConcurrent?: number;
  /** Trusted session-bound verifier; configured writes require literal true. */
  verifyCsrf?: (request: Request) => boolean | Promise<boolean>;
  /** Optional authenticated UI token issuer; requires a verifier and never bypasses authorization. */
  issueCsrfToken?: (request: Request) => string | Promise<string>;
  /** Explicit host-owned files, independent of API prefix. No assets are started/built. */
  styleHref?: string;
  /** Optional host module asset replacing built-in inline client; no build or serving occurs. */
  scriptSrc?: string;
  /** Optional durable host sink paired with auditContext; precommit failure prevents mutation, postcommit failure reports committed. */
  audit?: (event: Readonly<TagAdminAuditEvent>) => void | Promise<void>;
  /** Fresh host tenant/actor resolver required alongside the audit sink. */
  auditContext?: (request: Request) =>
    | {
        /** Opaque host-verified tenant label, never inferred from stored public content. */
        tenant: string; /** Opaque host-verified initiating actor; no recipient address or private traits. */
        actor: string;
      }
    | Promise<{
        /** Opaque host-verified tenant label, never inferred from stored public content. */
        tenant: string; /** Opaque host-verified initiating actor; no recipient address or private traits. */
        actor: string;
      }>;
}
/** Validate an explicit administration URL path, independent of filesystem paths and telemetry mounting.
 * @param {string} value - Root-relative alphanumeric namespace without repeated/trailing slashes.
 * @returns {string} Validated unchanged route path; no route or listener is registered.
 */
export function adminPath(value: string) {
  if (
    typeof value !== 'string' ||
    !/^\/[A-Za-z0-9/_-]+$/.test(value) ||
    value.includes('//') ||
    value.endsWith('/')
  ) {
    throw new TypeError('Invalid admin base path');
  }
  return value;
}
/** Normalize an exact secure UI/API origin without reading request Host or forwarded headers.
 * @param {string} value - HTTPS origin or explicit localhost HTTP development origin, without credentials/path/query/fragment.
 * @returns {string} Canonical exact origin; wildcard and opaque origins reject.
 */
export function adminOrigin(value: string) {
  /** Parsed explicit origin/asset URL; no outbound request or redirect occurs. */
  const url = new URL(value);
  if (
    url.hostname.includes('*') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      ))
  ) {
    throw new TypeError('Explicit secure admin origin required');
  }
  return url.origin;
}
/** Validate a host-built stylesheet or module URL without fetching, building or serving it.
 * @param {string} value - Bounded root asset path or absolute secure URL; traversal/query/fragment/markup reject.
 * @returns {string} Validated asset reference; host still owns MIME, CSP and serving policy.
 */
export function adminAsset(value: string) {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    /[\s<>"'\\?#]/.test(value) ||
    value.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new TypeError('Invalid admin asset URL');
  }
  if (value.startsWith('/') && !value.startsWith('//')) {
    if (!/^\/[A-Za-z0-9_./-]+$/.test(value)) {
      throw new TypeError('Invalid admin asset path');
    }
    return value;
  }
  /** Parsed explicit origin/asset URL; no outbound request or redirect occurs. */
  const url = new URL(value);
  adminOrigin(url.origin);
  if (!/^\/[A-Za-z0-9_./-]+$/.test(url.pathname)) {
    throw new TypeError('Invalid admin asset path');
  }
  return url.href;
}
