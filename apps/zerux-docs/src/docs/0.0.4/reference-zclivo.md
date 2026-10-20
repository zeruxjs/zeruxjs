---
{
  "title": "Composable CLI applications",
  "description": "Set up zclivo with explicit lifecycle, typed public APIs and deployment boundaries.",
  "section": "Packages",
  "order": 210,
  "package": "zclivo",
  "sources": [
    "packages/zclivo/README.md",
    "packages/zclivo/package.json"
  ],
  "related": [
    "packages",
    "typescript",
    "configuration-reference"
  ]
}
---

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
