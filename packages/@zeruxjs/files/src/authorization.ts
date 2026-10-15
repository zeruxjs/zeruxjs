import type { FileAddress, FileInfo } from './types.js';
/** Minimal structural contract accepted from @zeruxjs/auth token stores or external token validators. */
export interface StorageTokenVerifier {
  verify(token: string, scope?: string): {subject: string; scopes: string[]} | null | Promise<{subject: string; scopes: string[]} | null>;
}
export interface StorageTokenAuthOptions {
  /** Permission naming: e.g. files:read:photos, files:write:photos, files:delete:photos. */
  scopePrefix?: string;
  /** Explicitly allow anonymous reads of objects marked public. Defaults false. */
  publicRead?: boolean;
  /** Optional principal/tenant policy evaluated after token validation. */
  allow?: (subject: string, address: FileAddress, action: 'read'|'write'|'delete', info?: FileInfo) => boolean | Promise<boolean>;
}
/**
 * Bridges the scoped token store in @zeruxjs/auth without adding a hard runtime dependency.
 * Never trusts an unverified X-User, forwarded identity or query-string token.
 * The token store here is in-memory; production multi-node deployments need shared persistence.
 */
export function createFileTokenAuthorizer(store: StorageTokenVerifier, options: StorageTokenAuthOptions = {}) {
  if (!store || typeof store.verify !== 'function') throw new TypeError('Token verifier required');
  const prefix = options.scopePrefix ?? 'files';
  if(!/^[A-Za-z0-9:_-]{1,64}$/.test(prefix))throw new TypeError('Invalid scope prefix');
  return async (request: Request, address: FileAddress, action: 'read'|'write'|'delete', info?: FileInfo):Promise<boolean> => {
    if(action==='read'&&options.publicRead&&info?.visibility==='public')return true;
    const header=request.headers.get('authorization')??'';
    const match=/^Bearer ([A-Za-z0-9_.-]{1,256})$/.exec(header);
    if(!match)return false;
    const record=await store.verify(match[1],`${prefix}:${action}:${address.bucket}`);
    // Also permit a global permission explicitly issued by the application.
    const identity=record??await store.verify(match[1],`${prefix}:${action}:*`);
    if(!identity)return false;
    return options.allow ? !!await options.allow(identity.subject,address,action,info) : true;
  };
}
