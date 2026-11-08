# ZeruxJS

An npm monorepo for the ZeruxJS Node.js application framework, ZyroJS reactive/DOM library, and their supporting tools and services. Zenix has a minimal SQLite domain core and an initial opt-in SSR CMS application; the Zerux and Zyro generators are implemented, and the Zenix generator emits a host-configured SQLite CMS integration scaffold. Their READMEs describe the implemented boundaries.

## Packages

| Package | Purpose |
| --- | --- |
| [zeruxjs](packages/zeruxjs/README.md) | Application runtime, routing, plugins, services and workers |
| [zyrojs](packages/zyrojs/README.md) | Standalone reactivity, DOM rendering and network clients |
| [@zeruxjs packages](packages/@zeruxjs/README.md) | Database, cache, authentication, files, email, analytics and other modular APIs |
| [zhost](packages/zhost/README.md) | Hosting, protocol gateway, proxy and process supervision |
| [zclivo](packages/zclivo/README.md) | Composable commands, explicit CLI plugins and minimal app starter |
| [zlook](packages/zlook/README.md) | Shared filesystem watching |
| [zforge](packages/zforge/README.md) | Development tools and runtime inspection |
| [ztrial](packages/ztrial/README.md) | Test runner, assertions and optional environment adapters |
| [zlocale](packages/zlocale/README.md) | Gettext-style localization and native Intl formatting |
| [zuixs](packages/zuixs/README.md) | Utility CSS compiler and framework integrations |
| [zenixjs](packages/zenixjs/README.md), [@zenixjs/core](packages/@zenixjs/core/README.md) | Minimal SQLite domain core and initial ZyroJS/ZeruxJS CMS application |
| [create-zerux-js](packages/create/create-zerux-app/README.md) | Safe ZyroJS/React/Vue HTML-only SSR project generator |
| [create-zyro-app](packages/create/create-zyro-app/README.md) | Standalone client/static/SSR/hydrated ZyroJS generator |
| [create-zenix-js](packages/create/create-zenix-app/README.md) | Host-configured SQLite CMS integration generator |

Package manifests define current versions, supported Node.js versions, exports and dependencies. Read a package's README for setup, examples and limitations before using it. Frontend adapters do not imply a complete React/Vue rendering or hydration pipeline in ZeruxJS.

## Getting started

For framework usage, begin with the [documentation introduction](apps/zerux-docs/src/docs/0.0.4/introduction.md), [installation guide](apps/zerux-docs/src/docs/0.0.4/installation.md) and [tutorial](apps/zerux-docs/src/docs/0.0.4/tutorial.md). The [framework README](packages/zeruxjs/README.md) covers runtime APIs. `zclivo` provides a minimal application starter; the separate `create-*` packages generate their documented SSR, standalone or host-configured CMS templates.

For repository development, install dependencies using the committed npm lockfile (`npm ci` from the repository root), then work from the affected package directory:

```sh
cd packages/zeruxjs
npm run build
```

Build required workspace dependencies first. Run focused existing checks when needed; full test/lint/typecheck suites require an explicit request. Do not bump versions during development unless requested. See [AGENTS.md](AGENTS.md) for repository editing and verification rules. Application development servers may already be running; consult their READMEs before starting or rebuilding them.

For a clean package source build, use the dependency-aware `node scripts/build-workspaces.mjs --scope <package>` command. Compile-time imports of optional workspace peers are declared as development dependencies. The explicitly staged zforge build compiles its independent core before zhost/ZeruxJS and then requires its full strict build; this avoids relying on stale declarations while retaining optional consumer integrations. Bootstrap metadata is repository build tooling, not application configuration.

## Monorepo lint commands

Root `eslint.config.mjs` uses the public light preset from `@zeruxjs/lint` for
JS/JSX/TS/TSX (including `.mjs`, `.cjs`, `.mts`, `.cts`). Root
`stylelint.config.mjs` selects the existing standard CSS/SCSS configurations and
SCSS parser. These tools are explicit root development dependencies, installed
from the npm lockfile; the private Stylelint bundle and its prepack checks remain
separate. Use Node 24.15+ for the repository tooling.

```sh
npm ci --ignore-scripts
npm run lint:prepare     # build the shared preset and its three required packages
npm run lint             # read-only JS/TS, CSS/SCSS, then HTML; stops on failure
npm run lint:js
npm run lint:css
npm run lint:html
npm run lint:js:report    # reports/eslint.json
npm run lint:css:report   # reports/stylelint.json
npm run lint:html:report  # reports/htmlvalidate.json
# Explicitly opt into changes, then review the diff:
npm run lint:js:fix
npm run lint:css:fix
# Or run both fix commands sequentially:
npm run lint:fix
```

For a focused check, pass explicit files to the installed CLI instead of adding
paths to the scripts that already select the whole repository:

```sh
npm exec -- eslint --config eslint.config.mjs packages/zlook/src/index.ts
npm exec -- stylelint --config stylelint.config.mjs packages/zforge/assets/style.css
```

The root ESLint config keeps the preset's security/cleanup rules at error level.
Shared library source accepts both Node and browser ambient globals; that is not
browser-bundle verification. Dedicated client/server rules and runtime checks
retain their own responsibilities. CommonJS has an explicit source-type override.
Strict consumer/localization rules remain opt-in. Vue SFCs and CSS embedded in
HTML/JS are not parsed by these commands.

The root HTML checker uses `htmlvalidate.config.json` and `.htmlvalidateignore`.
Self-contained design previews explicitly allow their fixed authored inline styles;
structural HTML rules still run on those files. Other sources retain the inline
style check. Button types, list structure and password autocomplete remain checked.

Lint configs ignore dependency/build/cache/vendor/private runtime directories and
known generated workspace assets. Authored source, test and sample-module files
remain in scope; synthetic negative test code may need narrowly justified inline
suppressions. Configs are trusted executable code. Read-only commands never apply
fixes, and existing violations fail checks without being silently baselined.
`lint:prepare` does not start services, build apps or prepare publication archives.
The security workflow runs the same root report commands in separate jobs and
retains reports even when lint finds errors. Review initial findings before making
these checks mandatory in branch rules.

## Repository layout

- `packages/`: framework, library and tooling workspaces.
- `apps/`: development applications and the [documentation exporter](apps/zerux-docs/README.md).
- `sample-packages/`: private sample plugins, modules and dependency relationships for development.
- `pages/`: [shared ecosystem website](pages/README.md) and combined static build.
- `scripts/`, `tests/`, `integration-lab/`: workspace automation and [service acceptance checks](integration-lab/README.md).
- `vs-ext/zerux-n-zyro-js-dev/`: [VS Code extension](vs-ext/zerux-n-zyro-js-dev/README.md); development is currently on hold.

## Publishing and deployment

[Automatic npm publishing](NPM_PUBLISHING.md) describes version checks and trusted publishing. [GitHub Actions release checks](GITHUB_ACTIONS_RELEASE_SETUP.md) documents workspace verification and release evidence. [Static-site deployment](SITE_DEPLOYMENT.md) covers the combined website and documentation output.

Local builds and unit tests establish only the behavior they exercise. Consult package-specific integration requirements for databases, Redis, mail providers, cloud storage and browsers.

## Contributing, security and licenses

Read the [contribution guide](CONTRIBUTING.md), [development instructions](AGENTS.md), [code of conduct](CODE_OF_CONDUCT.md) and [security policy](SECURITY.md).

The project is dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE). Third-party dependencies retain their own licenses; see the [dependency inventory](assets/json/third-party.json) and [third-party notices](third-party-licenses/README.md).
