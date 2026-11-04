---
{"title":"create-zenix-js","description":"Safe generation of the host-configured SQLite CMS baseline.","section":"Packages","order":210,"package":"create-zenix-js","sources":["packages/create/create-zenix-app/README.md","packages/create/create-zenix-app/src/templates.ts"],"related":["packages","typescript","configuration-reference"]}
---

## Implemented baseline

`create-zenix-js` (binary `create-zenix`) generates the existing ZyroJS server-rendered UI, ZeruxJS runtime and Zenix core integration. Only JavaScript SSR, SQLite and no binary upload storage are available. No React/Vue, hydration, plugin marketplace or automatic account provisioning is supplied. Source implementation does not imply publication of version 0.0.4.

```sh
create-zenix cms --yes --database sqlite --storage none --port 3000 --dry-run
```

Dry-run produces an inspectable plan without writes. Normal generation uses zclivo exclusive staging and target/symlink checks; install/build/migrate/start remain explicit user commands. `planZenixApp` from `create-zenix-js` provides the same headless planning API.

## Private host preparation

The emitted host policy deliberately rejects startup with `ZENIX_HOST_POLICY_REQUIRED` until verified persistent sessions, tenant/site permissions, session-bound CSRF, admission, setup-secret verification and trusted recovery are configured. There are no default credentials. Environment templates have empty placeholders, are not auto-loaded and never contain browser secrets.

Node >=24.15.0 and native SQLite are required. Configure an exact origin, private absolute database path, tenant and site. Create/protect the parent directory, review backups/schema, then run `npm run migrate -- --approve`. This initializes schemas without creating an administrator or site. Runtime verifies existing schemas instead of silently migrating. External database provisioning and production auth/storage qualification remain host operations.

After implementing private host policies, authenticate the separately provisioned privileged operator at `/cms/login` and perform one-time `/cms/setup`. Durable setup claims prevent repeated initialization. Uncertain claims require fresh authorized operator recovery, not an automatic reset. `/cms/editor` saves drafts; preview remains private/noindex; publish separately exposes plain-text content at `/cms/page`.

## Qualification

The generator's isolated workspace-linked consumer checks build, SQLite schema reload, denied unconfigured startup and resource cleanup. These are not clean registry, browser, production authentication, TLS or proxy acceptance. See the package README and generated instructions for exact prerequisites and supported limits.
