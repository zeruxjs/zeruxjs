import { createSecurityPolicy } from '@zeruxjs/security';
export interface DevtoolsDocumentPolicyOptions {
    mode?: 'production' | 'development';
    /** Trusted exact app origins; never derived from Origin/Referer/Host. */
    frameAncestors?: readonly string[];
}
/** Per-document policy/nonce. Development framing is explicit; production ignores
 * development grants and retains the security composer's strict default policy.
 */
export function createDevtoolsDocumentPolicy(options: DevtoolsDocumentPolicyOptions = {}) {
    const mode = options.mode ?? 'production';
    if (!['production', 'development'].includes(mode)) throw new TypeError('Invalid devtools policy mode');
    return createSecurityPolicy(mode === 'development' ? {
        mode, frameAncestors: ["'self'"],
        ...(options.frameAncestors !== undefined ? { developmentFrameAncestors: options.frameAncestors } : {}),
        resources: { 'style-src': ["'self'", "'unsafe-inline'"], 'style-src-attr': ["'unsafe-inline'"], 'img-src': ["'self'", 'data:'], 'font-src': ["'self'", 'data:'] },
        // Explicit development document choice; never changed in response to a browser error.
        coep: 'unsafe-none'
    } : { mode }).createResponse();
}
