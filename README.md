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
| [`create-zerux-js`](./packages/create-zerux-js) | The CLI tool to scaffold and bootstrap new ZeruxJS projects globally via `npm create npm create zerux-js`. | yet to be released |
| [`zerux-js-dev`](./vs-ext/zerux-js-dev) | The official Visual Studio Code extension providing intelligent code completion, snippets, and framework integration. | yet to be released |

## 🚀 Getting Started

To create a new ZeruxJS project, you don't need to install anything globally. Simply run the `create-zerux-js` CLI using `npm`, `yarn`, or `pnpm`:

```bash
npm create zerux-js@latest my-app
# or
yarn create zerux-js my-app
# or
pnpm create zerux-js my-app
```

This will run an interactive prompt to set up a new project tailored to your requirements!

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

This project is licensed under the [MIT License](LICENSE).
