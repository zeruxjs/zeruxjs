import type { FileAddress, FileInfo } from './types.js';
/** Minimal structural contract accepted from @zeruxjs/auth token stores or external token validators. */
export interface StorageTokenVerifier {
  /** Verify the bearer token against a host-issued scope. Persistence, expiry and revocation belong to the injected verifier.
   * @param {string} token - Opaque bearer token; must never be logged.
   * @param {string | undefined} scope - Required permission name chosen by the server.
   * @returns {object | null | Promise<object | null>} Verified subject/scopes or null; callers do not infer identity from request claims.
   */
  verify(
    token: string,
    scope?: string
  ):
    | { subject: string; scopes: string[] }
    | null
    | Promise<{ subject: string; scopes: string[] } | null>;
}
/** Host-owned permission policy; construction acquires no verifier resources. */
export interface StorageTokenAuthOptions {
  /** Permission naming: e.g. files:read:photos, files:write:photos, files:delete:photos. */
  scopePrefix?: string;
  /** Explicitly allow anonymous reads of objects marked public. Defaults false. */
  publicRead?: boolean;
  /** Optional principal/tenant policy evaluated after token validation. */
  allow?: (
    subject: string,
    address: FileAddress,
    action: 'read' | 'write' | 'delete',
    info?: FileInfo
  ) => boolean | Promise<boolean>;
}
/** Bridge an injected verifier without importing auth at runtime. Never trusts forwarded identity or query-string tokens. The host owns verifier persistence and lifetime.
 * @param {StorageTokenVerifier} store - Borrowed trusted verifier responsible for expiry and scope enforcement.
 * @param {StorageTokenAuthOptions} options - Host authorization policy; anonymous public reads are disabled by default.
 * @returns {Function} Async authorization callback; token/policy failures propagate, missing identity returns false.
 */
export function createFileTokenAuthorizer(
  store: StorageTokenVerifier,
  options: StorageTokenAuthOptions = {}
) {
  if (!store || typeof store.verify !== 'function') {
    throw new TypeError('Token verifier required');
  }
  /** Host-selected permission namespace; validated before accepting requests. */
  const prefix = options.scopePrefix ?? 'files';
  if (!/^[A-Za-z0-9:_-]{1,64}$/.test(prefix)) {
    throw new TypeError('Invalid scope prefix');
  }
  return async (
    request: Request,
    address: FileAddress,
    action: 'read' | 'write' | 'delete',
    info?: FileInfo
  ): Promise<boolean> => {
    if (
      action === 'read' &&
      options.publicRead &&
      info?.visibility === 'public'
    ) {
      return true;
    }
    /** Bearer header only; no forwarded identity or URL token is accepted. */
    const header = request.headers.get('authorization') ?? '';
    /** Syntactically bounded bearer token match; not yet a verified identity. */
    const match = /^Bearer ([A-Za-z0-9_.-]{1,256})$/.exec(header);
    if (!match) {
      return false;
    }
    /** Bearer token captured from the validated authorization header. */
    const token = match[1];
    if (!token) {
      return false;
    }
    /** Bucket-scoped verified identity, when the host verifier accepts the permission. */
    const record = await store.verify(
      token,
      `${prefix}:${action}:${address.bucket}`
    );
    // Also permit a global permission explicitly issued by the application.
    /** Bucket-scoped identity or explicitly issued wildcard permission; never a browser role claim. */
    const identity =
      record ?? (await store.verify(token, `${prefix}:${action}:*`));
    if (!identity) {
      return false;
    }
    return options.allow
      ? !!(await options.allow(identity.subject, address, action, info))
      : true;
  };
}
