# Contributing to ZeruxJS

Read [AGENTS.md](AGENTS.md) for repository layout, editing rules, documentation requirements and secret handling. Participation follows the [code of conduct](CODE_OF_CONDUCT.md); report vulnerabilities using the [security policy](SECURITY.md).

## Setup

Use npm workspaces and a Node.js version compatible with the affected package manifests and CI workflow. Install the committed dependencies with `npm ci` at the repository root. Read the affected package README, then work from that package directory:

```sh
cd packages/zeruxjs
npm run build
npm test
```

Build required workspace dependencies first. Available checks vary by package; inspect its `package.json` before running commands. Do not start or rebuild application servers that may already be running manually. See [the docs authoring guide](apps/zerux-docs/README.md) for public API documentation.

The main CLI toolkit is `packages/zclivo`; dedicated generators under `packages/create/` remain placeholders. The VS Code extension lives in `vs-ext/zerux-n-zyro-js-dev`.

## Changes and pull requests

Keep each change focused. Preserve unrelated work, update affected usage documentation and run the relevant existing checks. Follow the current repository guidance on tests and linting instead of introducing broad tooling changes. Review the final diff for generated files and secrets.

Use a concise commit subject describing the change; a scope such as `docs(zlocale)` helps identify the affected package. In a pull request, explain the problem, resulting behavior, verification and any material limitations. Target the appropriate active branch and follow the repository's configured review and merge rules.
