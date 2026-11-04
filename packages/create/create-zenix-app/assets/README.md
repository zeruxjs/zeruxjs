# __NAME__

Initial CMS integration: ZyroJS HTML UI + ZeruxJS runtime + Zenix SQLite domain core. JavaScript SSR only, no hydration/React/Vue/admin plugin marketplace. No media upload/storage adapter is enabled. This is a host-policy integration scaffold, not a turnkey identity provider.

## Explicit preparation

Node >=24.15.0 with native node:sqlite is required. Review package.json, then explicitly run npm install, npm run typecheck, npm test, npm run build. Generation installed/executed nothing. Dependencies reference inspected workspace 0.0.4 APIs; verify registry exports or use qualified local artifacts if source is unpublished.

Implement src/host-policy.mjs using your private authenticated session system. It deliberately throws ZENIX_HOST_POLICY_REQUIRED until configured, including in dev/start. Required callbacks are documented in zenixjs/application (ZenixOptions) and @zenixjs/core/cms (CmsOptions). Provision the setup operator through that identity system separately: no password, account, setup secret or permissive principal is generated. Replace the scaffold smoke test's expected prerequisite rejection with your own policy tests once implemented.

Supply ZENIX_ORIGIN (exact origin, e.g. http://localhost:__PORT__), ZENIX_DATABASE (absolute file path in a private existing directory), ZENIX_TENANT and ZENIX_SITE through private process environment. .env.example contains empty placeholders and is not auto-loaded. Configure Secure/HttpOnly/SameSite cookies and session-bound CSRF, fresh per-action/core tenant authorization, login/setup admission, constant-time setup-secret verification and trusted recovery. Public reads need a fixed least-privilege host principal, never a caller role. Keep secrets out of public assets/config/logs and forwarded identity headers.

## Explicit durable schema/setup

Create the private database parent directory with operator-approved permissions and backups. Review migration code, then run npm run migrate -- --approve with private environment configured. Migration initializes core/setup tables only; it does not create an admin or initialize the site. Do not run migration concurrently with live traffic or treat its separate schema transactions as one atomic migration. External servers/databases are not installed. PostgreSQL/MySQL and binary/media storage are unsupported in this template.

After configuring real host policies and migrating, choose npm run dev or npm start after npm run build. Port __PORT__ is not reserved: change server.port/server.devPort if occupied; never terminate another app automatically. Startup verifies existing schema (migrate:false), owns no background migration and does not create a default account. Native forms work without JavaScript.

Authenticate at /cms/login as the separately provisioned privileged operator, then visit /cms/setup and submit the private setup secret. The durable CAS claim prevents repeated/concurrent setup. A failed/uncertain claimed setup is not automatically retried or reset: recover only through the trusted application's recoverSetup API after fresh operator verification and audit. Never expose recovery as an unprotected route or delete a claim to bypass it.

## Editorial and resource boundaries

/cms/admin and /cms/editor require server authorization. Save draft, privately preview a saved revision, and separately publish it. /cms/page exposes only published plain-text article content. Previews require fresh authentication and expiring session-bound capabilities, are no-store/noindex and are not public slug links. CMS owns CSRF/Origin validation and security headers; host callbacks still enforce identity and policy. Reverse proxy/TLS/cookie deployment must match the exact configured origin and preserve the reviewed direct Host. No cross-origin dashboard is supplied.

Data stays in the configured file-backed SQLite database; drafts/revisions and setup lock survive reload. Keep database/backup files outside public/, protect them and qualify backup durability. Application disposal drains before CMS/database close; borrowed host authentication services remain host-owned. No binary upload/catalog storage is configured: media authorization always denies. No browser role claim, executable saved content or discovered plugin is trusted.

Build verifies compilation, not private policy correctness or production readiness. Smoke checks inspect the manifest and intentional unconfigured-host failure. Host-policy, TLS/proxy, real browser/assistive technology and production identity/storage qualification remain required; no complete CMS parity is promised.
