# create-zenix-js

Safe generator for the implemented **ZyroJS UI + ZeruxJS runtime + Zenix core** baseline. npm name `create-zenix-js`, binary `create-zenix`, version unchanged. Only JavaScript SSR, file-backed SQLite and no binary upload storage are supported. No React/Vue CMS modes or invented dashboard are emitted.

```sh
node packages/create/create-zenix-app/dist/index.js cms --yes --database sqlite --storage none --port 3000 --dry-run
```

Remove `--dry-run` to write the inspected plan. `npm create zenix-js -- cms --yes` is the corresponding registry invocation only when the installed release contains these APIs; this change does not publish a release. `--help`/`--version` remain usable. With no arguments a TTY prompts for the same supported setup, name/path/port/language/mode choices. Noninteractive `--yes`, `--name`, `--destination`, `--port`, `--mode ssr`, `--renderer zyro`, `--language javascript` and `--dry-run` reuse zclivo. Unsupported providers/modes/languages fail visibly. Importing this package does not run the CLI.

## Required host integration

This is a durable CMS **integration scaffold**, not a bundled authentication service. The application contract exists in `zenixjs/application` and `@zenixjs/core/cms`; generation uses those public exports. Generated `src/host-policy.mjs` deliberately raises `ZENIX_HOST_POLICY_REQUIRED` before database startup until the operator implements persistent verified sessions, tenant/site permissions, CSRF, bounded login/setup admission, constant-time setup-secret verification and trusted recovery. It supplies no default admin, passwords, setup tokens, permissive principals or public secrets. Host authentication is a real prerequisite, not a fake login UI backed by arbitrary browser roles.

After reviewing output, explicitly install dependencies, typecheck, test and build. Node >=24.15.0 with native `node:sqlite` is required. Configure private process environment (`ZENIX_ORIGIN`, absolute `ZENIX_DATABASE`, `ZENIX_TENANT`, `ZENIX_SITE`); `.env.example` has empty placeholders and is not automatically loaded. Secret/session implementation remains host-owned. Database files and backups belong in a private, qualified existing directory, outside public assets.

`npm run migrate -- --approve` is a separate, reviewed operator action that initializes core/setup schemas; neither generation, build nor runtime silently migrates. It creates no account/site/content and does not claim both schemas migrate atomically. Startup uses `migrate:false`. External database installation, backups, migration coordination and production durability qualification remain explicit host operations. Media authorization always denies; there is no filesystem upload or remote storage template.

After real host policies and schema preparation, run dev or build/start. The configured port is not reserved; change it on conflict without stopping another application. The generated README explains `/cms/login`, one-time authenticated `/cms/setup`, editor/draft/private-preview/publish workflow and published `/cms/page`. A claimed setup is not deleted/retried automatically after uncertain failure: use the trusted application's recovery API with fresh privileged proof. No unprotected HTTP recovery route is generated.

## Safety and public API

zclivo validates names, paths, ports and template capabilities, refuses occupied/dangling-symlink targets, stages writes and rolls back partial output. Dry-run writes nothing. Ctrl-C owns cooperative cancellation and closes prompt resources. The generator never installs packages, runs migrations/generated code, provisions accounts or starts a server.

```js
import { planZenixApp } from 'create-zenix-js';
import { writeProjectPlanAsync } from 'zclivo';
const plan = planZenixApp({name:'cms',destination:'./cms',port:3000});
console.log(plan.files); // inspect only
// await writeProjectPlanAsync(plan);
```

The root and `/templates` exports expose the same generator. See [inert example](examples/plan.ts). Executable policies are trusted authored server modules, never discovered plugins or saved content. Host authentication resources remain borrowed; generated teardown drains the application before core/database shutdown and cleans failed startup. No hydration/browser secret bundle is supplied.

## Verification and limits

`npm run build --workspace=create-zenix-js` and `node --experimental-strip-types --test packages/create/create-zenix-app/test/generator.test.ts` check CLI safety and an isolated consumer using offline workspace links. The fixture builds, migrates/reloads synthetic SQLite, exercises unconfigured/missing-dependency failure, installs an explicitly denying synthetic policy and drains cleanup. It does not prove clean registry installation, real auth/TLS/proxy deployment or browser/assistive-technology behavior. Existing Zenix application tests qualify its setup/editor/publication behavior separately. Do not claim complete CMS parity or automatic security compliance.

License: MIT OR Apache-2.0.

## Planning versus execution

```js
import { planZenixApp } from 'create-zenix-js';

const plan = planZenixApp({
  name: 'cms',
  destination: './cms',
  port: 3000,
});
console.log(Object.keys(plan.files));
```

This call reads fixed shipped template assets and validates a reviewable plan.
It does not execute asset modules, open SQLite, install packages or run migrations.
`runCreateZenix(argv, options)` is the explicit programmatic CLI entry; importing
it registers no process listeners. The executable alone owns SIGINT/SIGTERM
listeners and removes them in `finally`. Host-provided prompts transfer their
cleanup to the shared generator command. Provider switches accept only SQLite
and no binary storage, reject duplicates, and stop interpreting provider options
after `--`. Other project flags retain the shared zclivo contract.

Generated source is trusted authored server code. Review and implement the host
policy before running it; no input content, saved CMS entry or browser role is
executed as that policy. Startup cleanup attempts application, core and database
shutdown in dependency order. It does not own or close host authentication stores.
