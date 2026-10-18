# Composable CLI applications

Set up zclivo with explicit lifecycle, typed public APIs and deployment boundaries.


## Installation and integration path

```sh
npm install zclivo@0.0.3
```

This package has its own public API. Installing it does not create an automatic runtime service key in `zerux.config.js`. Use the framework integration described below or initialize it in the tool/application that owns its lifetime.

## Worked TypeScript setup

```ts
import { CommandRegistry } from 'zclivo';
const commands = new CommandRegistry();
commands.registerKey('application', 'Application tasks');
commands.register('application', 'check', async (_args, context) => {
  if (context.options?.verbose) console.log('Checking application');
  return 0;
}, { flags: { verbose: { type: 'boolean', alias: 'v' } } });
const result = await commands.dispatch('application', ['check', '--verbose'], console.log);
process.exitCode = result.exitCode;
```

JavaScript can use the same runtime APIs without type-only statements. Enable JSDoc checking if editor validation is desired; a transpilation step alone does not typecheck the input.

## Usage and configuration

Register commands before dispatch and validate named flags with a declared schema. Handlers receive parsed arguments plus context/options and return an exit status; registration itself does not run handlers. Use an independent registry when multiple tools coexist in one process.

CLI plugins are loaded only from an explicit allowlist or configured package manifest entry. A plugin executes trusted Node code and can mutate application state; path validation does not sandbox it. `zeruxCli.plugins` belongs to the application's package.json plugin discovery contract, not an automatic arbitrary `zerux.config.js` key. Keep completion/help/documentation output separate from actual command execution.

## Public types

```ts
import { CommandRegistry } from 'zclivo';
type Inputs = ConstructorParameters<typeof CommandRegistry>;
type Result = InstanceType<typeof CommandRegistry>;
```

Use installed public declarations and validate untrusted runtime values separately. Avoid deep source imports; the manifest reference below records the actual exported entry points for this version. Generic helpers may preserve a more useful concrete type at the call site than a broad ReturnType alias.

## Failures, ownership and production use

Use the dispatch result instead of calling process.exit from reusable handlers. Unknown commands/invalid flags are distinct from a successful command; preserve nonzero status in automation. Async servers may retain handles after dispatch returns. Test help, aliases, repeated flags, wrong choices, unknown plugin entry paths and plugin exceptions. The reserved create packages do not become complete project generators merely because this toolkit contains scaffolding primitives.

## Verify the integration

Run the real owning application/tool with a normal input and a failure input. Inspect exit status or typed results, then verify cleanup/restart and the installed production entry point. A successful docs build does not exercise child processes, browser APIs, sockets or filesystem permissions on every supported operating system.

## Option reference

### CommandOptions

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `rea` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `description` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `help` | `{arg:string;'its description':string}[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `docs` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `example` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `aliases` | `string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `usage` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `hidden` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `flags` | `OptionSchema` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `allowUnknownFlags` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |

### StarterOptions

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `language` | `StarterLanguage` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `dryRun` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |


## Public entry points

Manifest reference for `zclivo@0.0.3`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {},
  "bin": {
    "zclivo": "./dist/bin.js"
  }
}
```


## Package README

# ZCLIVO — composable CLI toolkit

Command registry and explicit plugin discovery for ZeruxJS, ZyroJS, and other JavaScript applications. **This is an evolving 0.x package.** Commands can be shared under a common keyword without requiring plugins to mutate a global command map or immediately call `process.exit()`.

## Programmatic command registry

```ts
import { CommandRegistry } from 'zclivo';

const commands = new CommandRegistry();
commands.registerKey('zerux', 'ZeruxJS commands');
commands.register('zerux', 'build', async (args, context) => {
  console.log(context.options?.mode);
}, {
  aliases: ['b'],
  description: 'Build application',
  flags: {
    mode: { type: 'string', choices: ['dev', 'prod'], default: 'prod' },
    workers: { type: 'number', default: 2 },
    verbose: { type: 'boolean', alias: 'v' }
  }
});

const result = await commands.dispatch('zerux', ['build', '--mode', 'prod'], console.log);
process.exitCode = result.exitCode;
```

Supports named/positional arguments, repeated flags, aliases, `--help`, `--docs`, `--completion`, strict typed flags, required/default/choice validation, and reusable command definitions. No handlers are executed during registration.

## Shared commands from multiple packages

**Only explicitly configured plugins are loaded.** Declare allowlisted plugins in the application's `package.json`:

```json
{
  "zeruxCli": { "plugins": ["my-zerux-plugin", "@example/zerux-cli"] }
}
```

Each installed plugin has a `zerux` entry in its own manifest:

```json
{ "name": "my-zerux-plugin", "type": "module", "zerux": "./dist/plugin.js" }
```

Its entry exports a `register` function:

```js
export function register({ commands }) {
  commands.register('zerux', 'lint-custom', () => console.log('Linting'));
}
```

Load via `await loadConfiguredPlugins(registry, projectRoot)` or `await loadPlugins(['my-zerux-plugin'], registry, projectRoot)`.

Plugins are **trusted executable code**, not sandboxed extensions. Entry paths are checked using canonical filesystem paths and cannot escape their owning package through symlinks or traversal. Plugins are no longer automatically loaded from every installed `node_modules` package.

## Existing ZeruxJS compatibility

`import { cli } from 'zclivo'` still exposes `cli.addKey(keyword, {func,description})` and `cli.addCommand(keyword, name, handler, options)` with the same parsed argument structure. Legacy handlers no longer cause an immediate `process.exit()`; set `process.exitCode` if an explicit exit status is needed. Asynchronous development servers continue to run while they have active handles.

## Validation

```sh
npm run build
node --test test/*.test.mjs
```

## Section 79 — safe app starter

After installing/building this package, use `zclivo create my-app` (TypeScript),
`zclivo create my-app --js` (JavaScript), or `zclivo create my-app --dry-run` to inspect
what will be written. Programmatic usage:

```ts
import { createZeruxProject } from 'zclivo';
const result = createZeruxProject('./my-app', { language: 'typescript' });
console.log(result.files);
```

The destination must be a new, non-hidden directory with an existing parent.
The generator stages files, claims its target directory exclusively, refuses
existing files/directories **including dangling symlinks**, and cleans up on
failed writes; no `--force` overwrite or shell command is run. Starters use only
public `zeruxjs` dependencies and Node's test runner. The generated source is
intentionally minimal—not a fully integrated demo or live-deployment proof.
`npm install`, `npm run dev`, `npm run build`, browser acceptance and real service
configuration must be verified separately in a clean environment.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Release 0.0.3

Synchronized ecosystem release, including Zuixs CSS-entry support and documentation updates. Existing placeholder packages retain their documented limitations.


## Implementation sources

- [packages/zclivo/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zclivo/README.md)
- [packages/zclivo/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zclivo/package.json)
