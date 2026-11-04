import type { TenantPrincipal } from '@zeruxjs/auth';
import type { FileAddress } from '@zeruxjs/files';
import type { SqliteConnector } from '@zeruxjs/db-sqlite';
export interface CmsScope {
  tenant: string;
  site: string;
}
export interface CmsSite extends CmsScope {
  name: string;
  createdAt: number;
}
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
export interface CmsMediaReference extends FileAddress {
  versionId: string;
  sha256: string;
}
export type CmsField = (
  | { kind: 'text'; maxLength: number; values?: readonly string[] }
  | { kind: 'number'; min: number; max: number }
  | { kind: 'boolean' }
  | { kind: 'media' }
) & { required?: boolean };
export interface CmsContentType {
  id: string;
  version: number;
  fields: Readonly<Record<string, CmsField>>;
}
export interface CmsRevision extends CmsScope {
  entryId: string;
  revision: number;
  state: 'draft' | 'published';
  type: string;
  typeVersion: number;
  values: Record<string, string | number | boolean | CmsMediaReference>;
  actor: string;
  createdAt: number;
  sourceRevision?: number;
}
export interface CmsEntry extends CmsScope {
  id: string;
  type: string;
  typeVersion: number;
  head: number;
  publishedRevision: number | null;
  state: 'draft' | 'published';
}
export interface CmsPlugin {
  id: string;
  setup(context: {
    cms: import('./cms.js').Cms;
    signal: AbortSignal;
    onDispose(callback: () => void | Promise<void>): void;
  }): void | Promise<void>;
}
export interface CmsOptions {
  adapter: 'sqlite';
  filename?: string;
  /** Borrowed, genuinely file-backed connector. Host qualifies durability; CMS never closes it. */
  connection?: SqliteConnector;
  /** Explicit startup migration approval, not request input. False verifies the current journal only. */
  migrate?: boolean;
  resolvePrincipal(
    principal: unknown,
    context: { signal: AbortSignal },
  ): TenantPrincipal | null | Promise<TenantPrincipal | null>;
  /** Must verify tenant ownership, files authorization and immutable version/hash. Never fetch supplied URLs. */
  authorizeMedia(
    reference: Readonly<CmsMediaReference>,
    principal: Readonly<TenantPrincipal>,
    scope: Readonly<CmsScope>,
    signal: AbortSignal,
  ): boolean | Promise<boolean>;
  plugins?: readonly CmsPlugin[];
  maxPending?: number;
  timeoutMs?: number;
}
export class CmsError extends Error {
  constructor(
    readonly code: string,
    cause?: unknown,
  ) {
    super(`CMS operation failed (${code})`);
    this.name = 'CmsError';
    if (cause !== undefined)
      Object.defineProperty(this, 'cause', { value: cause });
  }
}
