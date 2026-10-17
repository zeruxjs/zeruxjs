# ZeruxJS

<div align="center">
  <p><strong>A modern Node.js framework for building fast and scalable applications.</strong></p>
</div>

Welcome to the **ZeruxJS** monorepo! This repository contains the core packages that make up the ZeruxJS ecosystem, providing a seamless and highly productive developer experience.

## 📦 Packages

This repository is a monorepo containing several interconnected packages:

| Package | Description | Version |
| ------- | ----------- | ------- |
| [`zyro`](./packages/zyrojs) | Library for building fast and scalable applications. | yet to be released |
| [`@zeruxjs`](./packages/@zeruxjs) | The core Node.js framework. Contains the main runtime, API, and core logic. | yet to be released |
| [`create-zerux-js`](./packages/create/create-zerux-app) | Placeholder for a future ZeruxJS project generator; currently supports help/version only. | yet to be released |
| [`zerux-js-dev`](./vs-ext/zerux-js-dev) | The official Visual Studio Code extension providing intelligent code completion, snippets, and framework integration. | yet to be released |

## 🚀 Getting Started

The two CMS packages and three creator packages are public `0.0.1` placeholders for future development. The creator packages currently contain placeholder CLIs; project generation is not implemented in version `0.0.1`. Use the applications under `apps/` as development examples, and read the individual package READMEs for available APIs.

See [the package release review](PACKAGE_RELEASE_REVIEW.md) for publication checks, release order, and known limitations.

## ✨ Features

- **Blazing Fast**: Engineered from the ground up for maximum performance in Node.js.
- **Developer First**: Excellent TypeScript support and editor intellisense out-of-the-box.
- **Modular Ecosystem**: Only include what you need.
- **Zero Configuration**: Get started quickly with sensible defaults.

## 🧩 VS Code Extension

For the best developer experience, we highly recommend installing the [ZeruxJS VS Code Extension](./vs-ext/zerux-js-dev). It provides:

- Auto-completion for framework-specific APIs.
- Built-in snippets for common patterns.
- Real-time linting and contextual help.

## 🤝 Contributing

We welcome contributions from the community! Whether it's adding a new feature, fixing a bug, or improving the documentation, your help is appreciated.

Please read our [Contributing Guide](CONTRIBUTING.md) to learn about our development process, how to propose bugfixes and improvements, and how to build and test your changes to ZeruxJS.

Be sure to also review our [Code of Conduct](CODE_OF_CONDUCT.md).

## 🔒 Security

If you discover a security vulnerability within ZeruxJS, please refer to our [Security Policy](SECURITY.md) for information on how to securely report it.

## 📝 License

This project is dual-licensed under:

- [MIT License](LICENSE-MIT)
- [Apache License, Version 2.0](LICENSE-APACHE)

You may choose either license for your use.

## Third-Party Dependencies

more info on all at [Third-Party Dependencies](./assets/json/third-party.json)
| Dependency | Version | License | Source | Used In |
|-----------|--------|--------|--------|--------|
| Portless | 0.7.1 | Apache 2.0 | [Github](https://github.com/vercel-labs/portless), [Website](https://port1355.dev/) | @zerux/server - [Package](./packages/zsrv) + [Assets](./packages/zsrv/assets/json/third-party.json) |
| Valibot | 1.3.1 | MIT | [Github](https://github.com/open-circle/valibot), [Website](https://valibot.dev/) | @zerux/validator - [Package](./packages/@zeruxjs/validator) + [Assets](./packages/@zeruxjs/validator/assets/json/third-party.json) |

## Package release readiness (CI)

GitHub Actions source checks, clean cross-platform builds, npm tarball consumers, lockfile recovery and the real-service acceptance lab are documented in [GITHUB_ACTIONS_RELEASE_SETUP.md](GITHUB_ACTIONS_RELEASE_SETUP.md). The package candidates are **not yet certified for stable public npm release**; checks fail closed until registry, provider, browser and semver evidence passes. Existing application workspaces are preserved but outside the package-only gate.

## Parallel package builds

Workspace builds automatically run independent packages in parallel based on the runner's available CPUs and effective RAM limit, completing dependencies before their consumers. An 8-core runner can use eight parallel builds; larger runners can use more, up to 32. The memory budget reserves one quarter of RAM and allows 512 MiB per compiler. GitHub Actions and the scoped test/build runners share this default. Developer and ZyroJS test runners build their selected packages in one plan, avoiding repeated dependency builds; frontend test compilation also uses the shared limit. Tests wait for their required builds to finish.

GitHub Actions explicitly uses `--concurrency auto`. Set a specific count with `npm run build:workspaces -- --concurrency 8`; automatic sizing is the default everywhere. Individual package builds remain unchanged.
