# ZeruxJS

An npm monorepo for the ZeruxJS Node.js application framework, ZyroJS reactive/DOM library, and their supporting tools and services. Zenix has a minimal SQLite domain core and an initial opt-in SSR CMS application; the Zerux and Zyro generators are implemented, and the Zenix generator emits a host-configured SQLite CMS integration scaffold. Their READMEs describe the implemented boundaries.

## Packages

| Package                                                                                  | Purpose                                                                         |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [zeruxjs](packages/zeruxjs/README.md)                                                    | Application runtime, routing, plugins, services and workers                     |
| [zyrojs](packages/zyrojs/README.md)                                                      | Standalone reactivity, DOM rendering and network clients                        |
| [@zeruxjs packages](packages/@zeruxjs/README.md)                                         | Database, cache, authentication, files, email, analytics and other modular APIs |
| [zhost](packages/zhost/README.md)                                                        | Hosting, protocol gateway, proxy and process supervision                        |
| [zclivo](packages/zclivo/README.md)                                                      | Composable commands, explicit CLI plugins and minimal app starter               |
| [zlook](packages/zlook/README.md)                                                        | Shared filesystem watching                                                      |
| [zforge](packages/zforge/README.md)                                                      | Development tools and runtime inspection                                        |
| [ztrial](packages/ztrial/README.md)                                                      | Test runner, assertions and optional environment adapters                       |
| [zlocale](packages/zlocale/README.md)                                                    | Gettext-style localization and native Intl formatting                           |
| [zuixs](packages/zuixs/README.md)                                                        | Utility CSS compiler and framework integrations                                 |
| [zenixjs](packages/zenixjs/README.md), [@zenixjs/core](packages/@zenixjs/core/README.md) | Minimal SQLite domain core and initial ZyroJS/ZeruxJS CMS application           |
| [create-zerux-js](packages/create/create-zerux-app/README.md)                            | Safe ZyroJS/React/Vue HTML-only SSR project generator                           |
| [create-zyro-app](packages/create/create-zyro-app/README.md)                             | Standalone client/static/SSR/hydrated ZyroJS generator                          |
| [create-zenix-js](packages/create/create-zenix-app/README.md)                            | Host-configured SQLite CMS integration generator                                |

Package manifests define current versions, supported Node.js versions, exports and dependencies. Read a package's README for setup, examples and limitations before using it. Frontend adapters do not imply a complete React/Vue rendering or hydration pipeline in ZeruxJS.

## Getting started

For framework usage, begin with the [documentation introduction](apps/zerux-docs/src/docs/0.0.4/introduction.md), [installation guide](apps/zerux-docs/src/docs/0.0.4/installation.md) and [tutorial](apps/zerux-docs/src/docs/0.0.4/tutorial.md). The [framework README](packages/zeruxjs/README.md) covers runtime APIs. `zclivo` provides a minimal application starter; the separate `create-*` packages generate their documented SSR, standalone or host-configured CMS templates.

For repository development, install dependencies using the committed npm lockfile (`npm ci` from the repository root), then work from the affected package directory:

```sh
cd packages/zeruxjs
npm run build
```

Build required workspace dependencies first. Run focused existing checks when needed; full test/lint/typecheck suites require an explicit request. Do not bump versions during development unless requested. See [AGENTS.md](AGENTS.md) for repository editing and verification rules. Application development servers may already be running; consult their READMEs before starting or rebuilding them.

For a clean package source build, use the dependency-aware `node --experimental-strip-types scripts/build-workspaces.ts --scope <package>` command. Compile-time imports of optional workspace peers are declared as development dependencies. The explicitly staged zforge build compiles its independent core before zhost/ZeruxJS and then requires its full strict build; this avoids relying on stale declarations while retaining optional consumer integrations. Bootstrap metadata is repository build tooling, not application configuration.

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

## Readable source and incremental quality review

Root `prettier.config.mjs` defines two-space indentation, semicolons, single
quotes and an 80-column wrapping target. Prettier handles JS/TS, CSS/SCSS, HTML,
JSON, Markdown and YAML; semantic checks remain in ESLint, Stylelint and
HTML-validate. Embedded source strings are not automatically reformatted:
whitespace-sensitive templates, protocol fixtures and generated code require
manual review. Formatting cannot reconstruct meaningful names or comments from
minified code.

```sh
# Select exactly the current package; never run a bulk write during this pass.
npm run format:write -- packages/@zeruxjs/typescript
npm run format:check -- packages/@zeruxjs/typescript
npm run format:reviewed   # CI checks only completed scopes
npm run quality:policy   # focused formatter/lint configuration regressions
```

`quality-scopes.json` records completed scopes, initially none. A completed
scope receives mandatory brace, single-statement-per-line and no-nested-ternary
ESLint checks, plus a read-only Prettier CI gate. Existing security errors remain
mandatory across the repository throughout migration. CSS checks enforce readable
comment spacing and rule separation; HTML checks enforce attribute quoting,
spacing and trailing whitespace alongside the existing semantic/accessibility
rules. No existing scanner is disabled to make the migration pass.

Explain the purpose and contract of public/nontrivial functions and comment the
reason for complex algorithms, state transitions, authorization, resource ownership
and cleanup. Avoid line-by-line narration, repeated types and invented guarantees.
Each function contract includes typed `@param` and `@returns` tags with meaningful
descriptions; document optional defaults, failure/rejection behavior and each
public option/result property. Every const declaration has an adjacent comment
explaining its data or ownership. Loop bindings are documented at the loop; imports
and anonymous callback parameters do not need artificial constant comments.
`eslint-plugin-jsdoc` enforces these requirements in reviewed scopes and does not
autogenerate empty documentation. A lint pass cannot establish that a comment is correct. Review module boundaries
and extract coherent helpers only when doing so improves comprehension without
changing supported APIs.

The operator's local `notes/sprint.md` lists each real package, sample package,
application and remaining repository scope. Complete one item per continuation
and record its checks before marking it done. `notes/` remains ignored by Git;
shared standards and the reviewed-scope gate are tracked here and in `AGENTS.md`.
Generated/build output, dependencies, frozen reference snapshots and licensed
vendor code are excluded. Preserve byte-sensitive fixtures and document necessary
exceptions rather than weakening security rules or silently skipping authored code.

### Readability rule matrix

These are repository standards inspired by consistent review practices, not WPCS
compatibility or a claim that static checks prove runtime correctness. They apply
to completed scopes across libraries, framework code, CMS and applications.

| Area                        | Enforcement and review boundary                                                                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Documentation               | JSDoc presence for functions/classes, standalone constants and named interface fields; parameter names/types/descriptions, return types/descriptions, tag/type syntax and nonempty descriptions. Meaning, accuracy, throws and lifecycle coverage are reviewed manually. |
| Control flow                | Required braces, one statement per line, no nested ternaries, sequence expressions, labels or `with`.                                                                                                                                                                    |
| Values and language hazards | Strict equality, no `var`, prefer `const`, explicit parseInt radix, no primitive wrappers or prototype/iterator mutation.                                                                                                                                                |
| Security and ownership      | Existing package preset rules remain errors: eval/dynamic functions, proven client/server import violations, unsafe public configuration and missing cleanup ownership. Authorization/tenant isolation remain runtime responsibilities.                                  |
| Complexity                  | Cyclomatic complexity above 25 and nesting beyond 4 produce review warnings. Validation-heavy APIs may need an explicit follow-up; do not hide findings or refactor without behavior checks.                                                                             |
| TypeScript                  | Keep signatures and docs consistent; typecheck/build in the owner. Do not add `any`, assertions or suppressions merely to silence quality checks.                                                                                                                        |
| Node/browser boundaries     | Preserve import maps and optional peers; no blanket bans on valid native APIs, DOM usage in browser entries, console in CLIs, or process lifecycle in owned entry points. Never infer server execution rights from documentation.                                        |
| CSS/HTML                    | Existing standard/SCSS/semantic/accessibility rules plus comment/attribute spacing and quoted attributes; Prettier owns wrapping. Embedded templates and dynamic DOM relationships need focused review.                                                                  |
| Runtime reliability         | Review cancellation versus settlement, borrowed versus owned resources, structured errors, bounded queues, sensitive logs and cleanup. Static documentation rules cannot prove these guarantees.                                                                         |
| Tests and fixtures          | Same readability and const-comment standards; preserve negative cases, exact protocol bytes, snapshots and public-import consumer coverage.                                                                                                                              |

Do not enable every available rule indiscriminately: line-length/indent rules
conflict with Prettier; mandatory comments on every anonymous callback add noise;
universal Node bans break browser/CLI contracts; arbitrary function-size caps can
obscure transactional ownership. Review the applicable rule options and add a
positive and negative fixture when extending the enforced policy.

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

Reviewed parent scopes may name separately owned child manifests in `quality-scopes.json` under `deferred`. Those children stay out of that parent readability/format gate until their own checklist item; global security scanning is unchanged. The lint package also owns opt-in managed-package usage and explicit API-deprecation registries; see its package README for verified mappings, typed registration and native-integration exceptions.
