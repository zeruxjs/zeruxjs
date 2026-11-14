import type { TenantPrincipal } from '@zeruxjs/auth';
import type { FileAddress } from '@zeruxjs/files';
import type { SqliteConnector } from '@zeruxjs/db-sqlite';
/** Exact domain boundary; validation and authorization are deliberately separate. */
export interface CmsScope {
  /** Exact validated tenant identifier; never grants permission on its own. */
  tenant: string;
  /** Exact validated site identifier; every operation also needs a verified site allowlist grant. */
  site: string;
}
/** Private scoped site metadata, not a grant of public-read access. */
export interface CmsSite extends CmsScope {
  /** Inert nonblank site label, at most 200 characters; renderers must escape it. */
  name: string;
  /** Server wall-clock creation time as Unix epoch milliseconds, not an ordering or authorship proof. */
  createdAt: number;
}
/** Explicit capabilities granted only through verified host principals. */
export type CmsPermission =
  | 'cms:read'
  | 'cms:site-manage'
  | 'cms:type-manage'
  | 'cms:write'
  | 'cms:publish';
/** Convenience policy data only. Hosts grant verified permissions, never a caller role string. */
export const cmsRolePermissions: Readonly<
  Record<
    'reader' | 'author' | 'publisher' | 'administrator',
    readonly CmsPermission[]
  >
> = Object.freeze({
  reader: Object.freeze(['cms:read'] as const),
  author: Object.freeze(['cms:read', 'cms:write'] as const),
  publisher: Object.freeze(['cms:read', 'cms:write', 'cms:publish'] as const),
  administrator: Object.freeze([
    'cms:read',
    'cms:write',
    'cms:publish',
    'cms:site-manage',
    'cms:type-manage',
  ] as const),
});
/** Files-owned address plus immutable version/integrity metadata; binary ownership stays external. */
export interface CmsMediaReference extends FileAddress {
  /** Immutable files-owned object version reference, checked by host media authorization. */
  versionId: string;
  /** Lowercase SHA-256 metadata checked with the host; a digest is not a permission grant. */
  sha256: string;
}
/** Bounded scalar/media schema; no executable expressions, relations or nested rich text. */
export type CmsField = (
  | {
      /** One supported field shape; executable/nested arbitrary content kinds are not accepted. */
      kind: 'text'; /** Text limit between 1 and 8,192 UTF-16 code units. */
      maxLength: number; /** Optional nonempty unique text enumeration, at most 64 allowed strings within maxLength. */
      values?: readonly string[];
    }
  | {
      /** One supported field shape; executable/nested arbitrary content kinds are not accepted. */
      kind: 'number'; /** Inclusive finite numeric lower bound; must not exceed max. */
      min: number; /** Inclusive finite numeric upper bound; must not precede min. */
      max: number;
    }
  | {
      /** One supported field shape; executable/nested arbitrary content kinds are not accepted. */
      kind: 'boolean';
    }
  | {
      /** One supported field shape; executable/nested arbitrary content kinds are not accepted. */
      kind: 'media';
    }
) & {
  /** Require an own input value when true; omission permits absence, not arbitrary null. */
  required?: boolean;
};
/** Immutable numbered content schema; prior versions must remain available. */
export interface CmsContentType {
  /** Validated scoped identifier; schema/plugin/entry ownership is checked separately. */
  id: string;
  /** Immutable contiguous schema version from 1 through 10,000. */
  version: number;
  /** One to 64 validated named fields; unknown keys and unsafe shapes reject. */
  fields: Readonly<Record<string, CmsField>>;
}
/** Immutable persisted revision detached from caller input on each JSON read. */
export interface CmsRevision extends CmsScope {
  /** Scoped entry owning this immutable revision. */
  entryId: string;
  /** Positive immutable revision number, bounded by the core integer policy. */
  revision: number;
  /** Newest revision state; a draft head may coexist with an earlier published pointer. */
  state: 'draft' | 'published';
  /** Immutable content type ID for this entry; updates cannot switch it. */
  type: string;
  /** Immutable schema version chosen when the entry is created. */
  typeVersion: number;
  /** Detached validated content fields; total serialized size is at most 32 KiB. */
  values: Record<string, string | number | boolean | CmsMediaReference>;
  /** String form of the host-verified principal userId recorded at commit time. */
  actor: string;
  /** Server wall-clock creation time as Unix epoch milliseconds, not an ordering or authorship proof. */
  createdAt: number;
  /** Optional historical source copied for publish/restore; no prior revision is overwritten. */
  sourceRevision?: number;
}
/** Optimistic entry head with an independent published-revision pointer. */
export interface CmsEntry extends CmsScope {
  /** Validated scoped identifier; schema/plugin/entry ownership is checked separately. */
  id: string;
  /** Immutable content type ID for this entry; updates cannot switch it. */
  type: string;
  /** Immutable schema version chosen when the entry is created. */
  typeVersion: number;
  /** Current optimistic revision number required by the next update, publish or restore. */
  head: number;
  /** Separate published revision pointer, or null before first publication. */
  publishedRevision: number | null;
  /** Newest revision state; a draft head may coexist with an earlier published pointer. */
  state: 'draft' | 'published';
}
/** Explicit trusted server plugin with instance-owned resource registration. */
export interface CmsPlugin {
  /** Validated scoped identifier; schema/plugin/entry ownership is checked separately. */
  id: string;
  /** Acquire only explicitly trusted plugin resources; register cleanup immediately.
   * @param {object} context - Borrowed instance and lifecycle registration helpers.
   * @param {import('./cms.js').Cms} context.cms - Borrowed domain API; writes commit independently.
   * @param {AbortSignal} context.signal - Cooperative instance cancellation; not forced JavaScript interruption.
   * @param {(callback: () => void | Promise<void>) => void} context.onDispose - Register LIFO resource cleanup, at most 64 callbacks.
   * @returns {void | Promise<void>} Setup completion; rejection triggers resource rollback, not rollback of earlier domain writes.
   */
  setup(context: {
    /** Borrowed instance for trusted plugin setup; plugin content writes are separate commits. */
    cms: import('./cms.js').Cms;
    /** Instance cancellation signal; callbacks must cooperate and own external deadlines. */
    signal: AbortSignal;
    onDispose(callback: () => void | Promise<void>): void;
  }): void | Promise<void>;
}
/** Host-only startup configuration; never construct this object from HTTP request data. */
export interface CmsOptions {
  /** Only sqlite is supported; there is no remote/async connector fallback. */
  adapter: 'sqlite';
  /** Trusted private file-backed path; excludes :memory:, URI filenames and request-selected paths. */
  filename?: string;
  /** Borrowed, genuinely file-backed connector. Host qualifies durability; CMS never closes it. */
  connection?: SqliteConnector;
  /** Explicit startup migration approval, not request input. False verifies the current journal only. */
  migrate?: boolean;
  /** Verify a fresh authenticated/unexpired host session; never accept browser role claims.
   * @param {unknown} principal - Opaque host session/proof, not trusted principal JSON.
   * @param {{signal: AbortSignal}} context - Borrowed cooperative cancellation scope.
   * @param {AbortSignal} context.signal - Host callback must observe cancellation and own external deadlines.
   * @returns {TenantPrincipal | null | Promise<TenantPrincipal | null>} Verified host identity or null to deny; tenant/site permission is checked separately.
   */
  resolvePrincipal(
    principal: unknown,
    context: {
      /** Instance cancellation signal; callbacks must cooperate and own external deadlines. */
      signal: AbortSignal;
    }
  ): TenantPrincipal | null | Promise<TenantPrincipal | null>;
  /** Verify tenant ownership, files authorization and immutable version/hash without fetching caller URLs.
   * @param {Readonly<CmsMediaReference>} reference - Detached validated address/version/hash metadata.
   * @param {Readonly<TenantPrincipal>} principal - Detached verified principal; not a new authentication grant.
   * @param {Readonly<CmsScope>} scope - Exact tenant/site target for binary policy checks.
   * @param {AbortSignal} signal - Cooperative instance cancellation; callback owns external deadlines.
   * @returns {boolean | Promise<boolean>} Exactly true to allow the reference; every other result denies it.
   */
  authorizeMedia(
    reference: Readonly<CmsMediaReference>,
    principal: Readonly<TenantPrincipal>,
    scope: Readonly<CmsScope>,
    signal: AbortSignal
  ): boolean | Promise<boolean>;
  /** Explicit trusted setup callbacks, at most 16; no disk/package scanning occurs. */
  plugins?: readonly CmsPlugin[];
  /** Maximum admitted operations: defaults to 16, between 1 and 64. */
  maxPending?: number;
  /** Synchronous transaction deadline in milliseconds: defaults to 5,000, at most 60,000. */
  timeoutMs?: number;
}
/** Stable public code/message with an optional private nonenumerable cause. */
export class CmsError extends Error {
  /** Construct a fixed-envelope domain error without enumerating its private cause.
   * @param {string} code - Trusted nonsensitive operational code; no content/credentials.
   * @param {unknown} cause - Optional underlying private diagnostic, never public HTTP data.
   */
  constructor(
    readonly code: string,
    cause?: unknown
  ) {
    super(`CMS operation failed (${code})`);
    this.name = 'CmsError';
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: cause });
    }
  }
}
