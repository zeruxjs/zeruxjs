import {createTagManager, type TagRuntimeOptions, type TagAdminAuditEvent} from '@zeruxjs/tags';

// Host supplies authenticated tenant/role checks and session-bound CSRF implementation.
export function createAdministration(
  host: Pick<TagRuntimeOptions, 'analytics' | 'requestIds' | 'store' | 'authorizeAdmin' | 'authorizePublish'>,
  security: {
    verifyCsrf(request: Request): Promise<boolean>;
    issueCsrfToken(request: Request): Promise<string>;
    auditContext(request: Request): Promise<{tenant: string; actor: string}>;
    audit(event: Readonly<TagAdminAuditEvent>): Promise<void>;
  },
) {
  return createTagManager({...host, site: 'shop', defaultConsent: 'denied', administration: {
    basePath: '/control/tags', uiPath: '/console/tags',
    publicOrigin: 'https://api.example.com',
    allowedOrigins: ['https://console.example.com'],
    styleHref: '/assets/tag-brand.css', // host-built/served; independent of API routes
    ...security,
  }});
}
// Mount returned routes in the host; await manager.close() during host teardown.
// For a separately hosted UI use serveUi:false and the browser example below.
