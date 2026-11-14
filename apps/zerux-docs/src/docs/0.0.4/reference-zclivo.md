---
{
  "title": "Composable CLI applications",
  "description": "Set up zclivo with explicit lifecycle, typed public APIs and deployment boundaries.",
  "section": "Packages",
  "order": 210,
  "package": "zclivo",
  "sources": [
    "packages/zclivo/README.md",
    "packages/zclivo/package.json",
    "packages/zclivo/src/commands.ts",
    "packages/zclivo/src/options.ts",
    "packages/zclivo/src/plugin-loader.ts",
    "packages/zclivo/src/lifecycle.ts"
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
npm install zclivo@0.0.4
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

Use the dispatch result instead of calling process.exit from reusable handlers. Unknown commands/invalid flags are distinct from a successful command; preserve nonzero status in automation. A long-running handler must keep its Promise pending for its resource lifetime; returning early ends invocation ownership and starts cleanup. Test help, aliases, repeated flags, wrong choices, unknown plugin entry paths and plugin exceptions. The separate create-zerux-js, create-zyro-app and create-zenix-js packages own their verified templates and prerequisites; zclivo itself supplies only the minimal starter and shared safe engine.

## Verify the integration

Run the real owning application/tool with a normal input and a failure input. Inspect exit status or typed results, then verify cleanup/restart and the installed production entry point. A successful docs build does not exercise child processes, browser APIs, sockets or filesystem permissions on every supported operating system.

## Option reference

### CommandOptions

| Option              | Accepted TypeScript value                 | Required | Meaning                                                                      |
| ------------------- | ----------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| `rea`               | `boolean`                                 | No       | Retained compatibility flag; it does not add a dispatch policy.              |
| `description`       | `string`                                  | No       | Help display text, terminal-sanitized when rendered.                         |
| `help`              | `{arg:string;'its description':string}[]` | No       | Legacy argument descriptions; display text only.                             |
| `docs`              | `string`                                  | No       | Authored documentation returned by --docs; never evaluated.                  |
| `example`           | `string`                                  | No       | Authored example display text; never executed.                               |
| `aliases`           | `string[]`                                | No       | Alternative command names validated against canonical/alias collisions.      |
| `usage`             | `string`                                  | No       | Authored usage suffix for command help.                                      |
| `hidden`            | `boolean`                                 | No       | Hide from listings/completion; this does not authorize or deny dispatch.     |
| `flags`             | `OptionSchema`                            | No       | Strict scalar option schema validated at registration and dispatch.          |
| `allowUnknownFlags` | `boolean`                                 | No       | Explicitly retain undeclared flags under a schema instead of rejecting them. |

### StarterOptions

| Option     | Type              | Meaning                                                                                |
| ---------- | ----------------- | -------------------------------------------------------------------------------------- |
| `language` | `StarterLanguage` | JavaScript or TypeScript supported by the minimal template.                            |
| `dryRun`   | `boolean`         | Validate and list files without writing the destination.                               |
| `name`     | `string`          | Portable display/package name; defaults from the destination.                          |
| `port`     | `number`          | Integer 1–65535 configuration, never a port reservation.                               |
| `renderer` | `string`          | Only `none` for this built-in minimal template.                                        |
| `mode`     | `string`          | Only `minimal` for this built-in template.                                             |
| `signal`   | `AbortSignal`     | Cooperative write cancellation; use the async writer to observe signals between files. |

## Predictable validation and lifecycle

Dispatch returns 0 for success/help, 2 for unknown command or malformed/invalid
options, 1 for handler/output/cleanup failure, and 130 for observed cancellation.
Previously invalid typed flags returned 1; update automation relying on that status.
Handlers may return an integer from 0 through 255. Only the owning entry point
sets process.exitCode; reusable dispatch never exits or changes process status.
Suggestions name visible registered commands/aliases or declared options without
executing them. This is a flat registry, not general nested CLI framework parity.

Declared boolean flags leave subsequent positional values intact (except literal
true/false). Repeated values remain arrays. `--` ends option/help/docs recognition.
Mixing an alias and canonical flag spelling is a conflict; repeat the same spelling.
OptionDefinition.conflicts lists canonical flag names and checks explicit input,
even false/empty, before defaults. Required flags still require explicit input.
Defaults must match the declared type/choices; definitions are snapshotted/frozen.
Argv is bounded to 1024 entries, 8192 code units each, 65536 total; schemas have at
most 128 flags. No grouped short flags or implicit --no-\* negation is provided.

```ts
import { setTimeout as delay } from 'node:timers/promises';
import { CommandRegistry } from 'zclivo';
const commands = new CommandRegistry();
commands.register('tool', 'wait', async (_args, context) => {
  const heartbeat = setInterval(() => {}, 1000);
  context.onDispose(() => clearInterval(heartbeat));
  await delay(25, undefined, { signal: context.signal });
});
const controller = new AbortController();
const interrupt = () => controller.abort();
process.once('SIGINT', interrupt);
try {
  const result = await commands.dispatch('tool', ['wait'], console.log, { signal: controller.signal });
  process.exitCode = result.exitCode;
} finally { process.off('SIGINT', interrupt); }
```

Invocation cleanup runs once in reverse acquisition order on success, failure or
abort, and attempts every callback. Cleanup failures are retained in cleanupErrors;
raw error/reason fields are internal and must not be printed wholesale. Help/docs,
messages and legacy log/error/success remove terminal escapes and controls except
LF/tab layout. Arbitrary handler console output remains its owner's responsibility;
terminal filtering is not secret redaction. Node's
[terminal stripping](https://nodejs.org/api/util.html#utilstripvtcontrolcharactersstr)
and [AbortController](https://nodejs.org/api/globals.html#class-abortcontroller)
are the underlying platform primitives.

Dispatch waits for cooperative handler completion and cleanup; ignoring a signal
can keep it pending indefinitely. Returning early ends invocation ownership. The
registry does not install process handlers or kill workers/processes. Close owned
resources through onDispose (at most 1024 callbacks), including on success.

## Plugin transactions and ownership

Explicit loadPlugins/loadConfiguredPlugins retain canonical package/path/symlink
checks and never scan/execute every installed package. Both accept a fourth
`{signal}` argument. register receives PluginContext.commands (a staging registry),
signal and onDispose; it may also return an async/sync disposer. Register rollback
immediately after acquiring resources. Conflicts/rejection discard all staged
commands, aliases, keywords and descriptions. Concurrent live mutation rejects
commit rather than overwriting it. Do not retain the staging registry for later
registration. Module top-level execution is still trusted code and cannot be undone.

Each LoadedPlugin.dispose is idempotent: abort commands, remove owned registrations,
wait for cooperative invocation cleanup, then release plugin resources. Owners must
await every disposer in finally even after external cancellation. A failed load
batch disposes prior successes in reverse order. Missing configured plugin/dependency
errors propagate; cleanup/rollback errors retain causes through AggregateError.
ESM caching is not unloading, and transactions do not sandbox plugin side effects
or protect writable package files against concurrent replacement. Keep code and
allowlists trusted. No plugin is loaded until explicitly configured.

ZeruxCLI.run is awaitable and dispose handles cooperative/plugin cleanup. Scheduled
addKey compatibility still runs once, and commands without schemas retain legacy
argument shapes. Existing framework servers are not automatically stopped by new
hooks. Focused Node tests and an offline installed declaration consumer verify these
contracts without starting applications; actual OS signal behavior and third-party
plugin cooperation require checks in the owning runtime.

## Shared safe generator engine

`createProjectGenerator` accepts explicit reviewed template functions and a bounded
mode/renderer/language matrix. `minimalProjectGenerator` currently exposes only
`zerux-minimal`, mode `minimal`, renderer `none`, for JavaScript/TypeScript. Unsupported
renderer/CMS/static combinations reject; creator packages are not auto-discovered.

Plans validate names, port, destination, file paths/size and parent/target ownership
without writes. Sync/async writers stage, exclusively claim and refuse overwrites;
async writing observes cancellation between files. Existing targets and dangling
symlinks remain untouched, and failure cleanup only removes owned paths.

The binary supports explicit `--interactive` or equivalent `--name`, `--destination`,
`--language`/`--js`/`--ts`, `--port`, `--mode`, `--renderer`, `--template`, `--yes` and
`--dry-run` flags. Help/docs use the registered capabilities. CI-style noninteractive
commands never install dependencies or start generated code. New directories are
private; whole-directory crash atomicity and hostile same-account filesystem races
are not claimed. See the package README and `examples/generator.ts` for ownership,
runtime floors, public APIs and checks.

## Resource handles and display boundaries

`CommandRegistry` registration is inert. A returned transaction disposer owns only
its staged additions; it does not unload modules or roll back arbitrary plugin
side effects. `loadPlugins` and `loadConfiguredPlugins` return owned records, so
retain the array and await each `dispose()` at the host lifecycle boundary.
`createTerminalGeneratorPrompt` is a lazy close owner; shared command orchestration
closes it when the invocation ends. Inert generators and parsed argument values
have no invented close method.

Terminal sanitization removes control sequences, not secrets. `color` deliberately
emits ANSI styles and stringifies application values without sanitizing their
contents. Keep raw error causes, input arguments and cleanup failures in private
tool diagnostics. Help visibility is not authorization, and a command schema does
not authorize the operation its trusted handler performs.

Planning and snapshot digests describe bytes, not permission or authorship. A plan
must come from this package instance before its writers accept it; importing a
serialized review document does not authorize writes. Template code is explicit
trusted server tooling, not a browser module or a safe place to evaluate saved
content. The package's lint boundaries detect direct static misuse only; they do
not prove eventual disposal, sandbox code or certify an authorization policy.
