import {
  createTagManager,
  type TagRuntimeOptions,
  type TagAdminAuditEvent,
} from '@zeruxjs/tags';

// Host supplies authenticated tenant/role checks and session-bound CSRF implementation.
/** Configure explicit server administration over borrowed analytics/stores and host-owned session, publisher, CSRF and audit policies. No listener or asset build starts here.
 * @param {Pick<
    TagRuntimeOptions,
    'analytics' | 'requestIds' | 'store' | 'authorizeAdmin' | 'authorizePublish'
  >} host - Borrowed analytics/request-ID/document stores plus fresh admin/publisher authorizers.
 * @param {{
    verifyCsrf(request: Request): Promise<boolean>;
    issueCsrfToken(request: Request): Promise<string>;
    auditContext(request: Request): Promise<{ tenant: string; actor: string }>;
    audit(event: Readonly<TagAdminAuditEvent>): Promise<void>;
  }} security - Trusted session-CSRF/token and durable audit callbacks; credentials stay private.
 * @param {Function} security.verifyCsrf - Fresh session-bound token verification for protected writes.
 * @param {Function} security.issueCsrfToken - Issue a token only through the authorized host session flow.
 * @param {Function} security.auditContext - Resolve opaque verified tenant and actor for each transition.
 * @param {Function} security.audit - Persist value-free audit events; required intent failure prevents mutation.
 * @returns {object} Owned manager; host mounts returned routes and awaits close before releasing dependencies.
 */
export function createAdministration(
  host: Pick<
    TagRuntimeOptions,
    'analytics' | 'requestIds' | 'store' | 'authorizeAdmin' | 'authorizePublish'
  >,
  security: {
    verifyCsrf(request: Request): Promise<boolean>;
    issueCsrfToken(request: Request): Promise<string>;
    auditContext(request: Request): Promise<{ tenant: string; actor: string }>;
    audit(event: Readonly<TagAdminAuditEvent>): Promise<void>;
  }
) {
  return createTagManager({
    ...host,
    site: 'shop',
    defaultConsent: 'denied',
    administration: {
      basePath: '/control/tags',
      uiPath: '/console/tags',
      publicOrigin: 'https://api.example.com',
      allowedOrigins: ['https://console.example.com'],
      styleHref: '/assets/tag-brand.css', // host-built/served; independent of API routes
      ...security,
    },
  });
}
// Mount returned routes in the host; await manager.close() during host teardown.
// For a separately hosted UI use serveUi:false and the browser example below.
