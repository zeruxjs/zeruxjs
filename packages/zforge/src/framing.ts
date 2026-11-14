import { createSecurityPolicy } from '@zeruxjs/security';
export interface DevtoolsDocumentPolicyOptions {
  /** Trusted document mode; defaults to production and does not follow browser errors. */
  mode?: 'production' | 'development';
  /** Trusted exact app origins; never derived from Origin/Referer/Host. */
  frameAncestors?: readonly string[];
}
/** Create fresh response-owned policy headers and nonce; only development honors explicit framing grants.
 * @param {DevtoolsDocumentPolicyOptions} options - Trusted host response policy settings; production is the default.
 * @returns {ReturnType<ReturnType<typeof createSecurityPolicy>['createResponse']>} Fresh document policy; the host retains response and authorization ownership.
 */
export function createDevtoolsDocumentPolicy(
  options: DevtoolsDocumentPolicyOptions = {}
) {
  /** Explicit trusted response policy mode; request headers never select development grants. */
  const mode = options.mode ?? 'production';
  if (!['production', 'development'].includes(mode)) {
    throw new TypeError('Invalid devtools policy mode');
  }
  return createSecurityPolicy(
    mode === 'development'
      ? {
          mode,
          frameAncestors: ["'self'"],
          ...(options.frameAncestors !== undefined
            ? { developmentFrameAncestors: options.frameAncestors }
            : {}),
          resources: {
            'style-src': ["'self'", "'unsafe-inline'"],
            'style-src-attr': ["'unsafe-inline'"],
            'img-src': ["'self'", 'data:'],
            'font-src': ["'self'", 'data:'],
          },
          // Explicit development document choice; never changed in response to a browser error.
          coep: 'unsafe-none',
        }
      : { mode }
  ).createResponse();
}
