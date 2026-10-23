# ZeruxJS

An npm monorepo for the ZeruxJS Node.js application framework, ZyroJS reactive/DOM library, and their supporting tools and services. Zenix CMS and the dedicated `create-*` CLIs are currently placeholders; their READMEs describe the available metadata and CLI behavior.

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
| [zenixjs](packages/zenixjs/README.md), [@zenixjs/core](packages/@zenixjs/core/README.md) | Future CMS placeholders |
| [create-zerux-js](packages/create/create-zerux-app/README.md), [create-zyro-app](packages/create/create-zyro-app/README.md), [create-zenix-js](packages/create/create-zenix-app/README.md) | Placeholder generator CLIs supporting help/version only |

Package manifests define current versions, supported Node.js versions, exports and dependencies. Read a package's README for setup, examples and limitations before using it. Frontend adapters do not imply a complete React/Vue rendering or hydration pipeline in ZeruxJS.

## Getting started

For framework usage, begin with the [documentation introduction](apps/zerux-docs/src/docs/0.0.4/introduction.md), [installation guide](apps/zerux-docs/src/docs/0.0.4/installation.md) and [tutorial](apps/zerux-docs/src/docs/0.0.4/tutorial.md). The [framework README](packages/zeruxjs/README.md) covers runtime APIs. `zclivo` provides a minimal application starter; the separate `create-*` packages do not yet generate projects.

For repository development, install dependencies using the committed npm lockfile (`npm ci` from the repository root), then work from the affected package directory:

```sh
cd packages/zeruxjs
npm run build
```

Build required workspace dependencies first. Run focused existing checks when needed; full test/lint/typecheck suites require an explicit request. Do not bump versions during development unless requested. See [AGENTS.md](AGENTS.md) for repository editing and verification rules. Application development servers may already be running; consult their READMEs before starting or rebuilding them.

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
