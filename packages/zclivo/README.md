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

## Safe app starter

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

## Predictable diagnostics and cancellation

Dispatch returns a result and never calls process.exit or changes process.exitCode.
The entry point owns status selection. The legacy wrapper and standalone binary
are entry-point conveniences and continue setting/returning status respectively.

| Outcome                                                              | exitCode |
| -------------------------------------------------------------------- | -------- |
| Success/help/docs/completion                                         | 0        |
| Handler rejection, invalid handler status, output or cleanup failure | 1        |
| Unknown keyword/command, malformed argv or invalid typed options     | 2        |
| Observed cooperative cancellation                                    | 130      |

A handler may return an integer from 0 through 255. Invalid flag usage previously
returned 1; migrate automation to 2. Typo suggestions cover registered visible
command names/aliases and declared flags; they never select or execute a command.
This is a flat keyword/command registry, not an arbitrary nested subcommand parser.
Flags retain string/number/boolean conversion, repeated arrays and negative values.
Aliases cannot shadow commands or other aliases. Mixing an option's full name and
alias is a spelling conflict; repeat the same spelling instead. A flag definition
can declare `conflicts: ['otherFlag']` using canonical schema names. Conflicts apply
to explicitly supplied options (even false/empty), before defaults. Required flags
still require explicit input even if a default is declared. Defaults must match
the type and string choices. Registered definitions are snapshotted and frozen.

Typed boolean flags do not consume a following positional unless it is the literal
true/false. The public parseArguments(argv) keeps legacy value consumption; its
optional second argument names boolean options. `--` ends all option/help/docs
recognition, so `run -- --help` passes a positional string to the handler. Grouped
short flags and implicit --no-\* negation are not implemented. Empty --name= is a
string value; a bare string/number flag without a value is invalid under a schema.
Without a schema, legacy unknown options remain accepted. Option names must be
ASCII alphanumeric/underscore/hyphen, starting with alphanumeric; prototype keys
reject. Limits: 1024 argv entries, 8192 UTF-16 code units per entry, 65536 total;
128 schema flags/aliases per command and 1024 cleanup callbacks per scope.

Help/docs/dispatch messages, formatError and legacy log/error/success strip terminal
CSI/OSC escapes and C0/C1 controls except ordinary LF/tab layout. This uses Node's
[stripVTControlCharacters](https://nodejs.org/api/util.html#utilstripvtcontrolcharactersstr)
plus control filtering. Colors deliberately generated by the public color helper
remain available to applications; arbitrary handler console output is caller-owned.
No credential redaction is inferred from terminal sanitization. Do not print secret
arguments. Result.error and cleanupErrors preserve raw server/tool-only failures;
print the sanitized message selectively, not the whole result or internal causes.

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
process.once('SIGINT', interrupt); // Only the entry point installs process listeners.
try {
  const result = await commands.dispatch('tool', ['wait'], console.log, {
    signal: controller.signal
  });
  process.exitCode = result.exitCode;
} finally { process.off('SIGINT', interrupt); }
```

Each invocation owns a signal and onDispose callback stack. Register cleanup as
soon as a resource is acquired. Cleanup runs once, in reverse order, on success,
failure or cancellation; failures do not skip remaining callbacks. Cleanup failure
sets status 1 (130 stays 130 if cancelled), retaining all cleanup errors. The scope
aborts its signal on completion and unlinks upstream listeners. Cancellation reasons
are internal; the public cancellation message is generic. See Node's
[AbortController contract](https://nodejs.org/api/globals.html#class-abortcontroller).
Dispatch waits for the handler and async cleanup to settle; it does not race them
against abort, kill processes or promise to interrupt noncooperative code. A handler
must keep its promise pending for the entire resource lifetime. If it returns early,
its invocation is complete and cleanup runs. There is no automatic SIGINT/SIGTERM
listener, timeout or process shutdown in the reusable registry.

## Trusted plugin registration and disposal

PluginContext now supplies `{commands, signal, onDispose}`. A plugin may register
cleanup callbacks immediately or return a disposer from its async/sync register
function. Only registration is staged: the supplied commands registry is for that
registration phase, and rejects later registration after commit/failure. Conflicts
or registration rejection discard the entire staged change, including aliases,
keywords and descriptions. A concurrent live registry mutation rejects the commit
rather than overwriting it. Existing imports, handlers and explicit plugin lists
remain supported. Direct `registry.transaction(register, signal?)` exposes the same
staging primitive; its returned removal callback waits for signal-owned commands,
so abort the supplied signal before awaiting removal of long-running commands.

```ts
import { CommandRegistry, loadConfiguredPlugins } from 'zclivo';
const commands = new CommandRegistry();
const plugins = await loadConfiguredPlugins(commands, process.cwd());
try {
  const result = await commands.dispatch('tool', process.argv.slice(2));
  process.exitCode = result.exitCode;
} finally {
  // Attempt every disposer even if another one rejects.
  const results = await Promise.allSettled([...plugins].reverse().map(plugin => plugin.dispose()));
  if (results.some(result => result.status === 'rejected')) process.exitCode = 1;
}
```

loadPlugins/loadConfiguredPlugins accept an optional fourth `{signal}` argument.
Each LoadedPlugin has signal and idempotent async dispose(). Disposal aborts active
cooperative commands, removes its own registrations, waits for invocation cleanup,
then runs plugin cleanup. It preserves unrelated commands. Passing a signal requests
cooperation; the owner must still await dispose in finally, including after abort.
A failed load batch disposes previously loaded entries from that batch in reverse
order; failures retain their original error and aggregate any rollback errors.
The complete allowlist is validated before importing any entry (at most 100 package
names). Missing modules and plugin dependency failures propagate. A missing configured
plugin is no longer silently ignored by the legacy ENOENT fallback.

Filesystem realpath/symlink containment and package-owned JavaScript entry checks
remain in resolvePluginEntry. No directory scan/autoactivation, installation, subprocess
or network call is added. Registration transactions cannot undo arbitrary module
side effects, unload ESM's cache, sandbox trusted plugin code or secure a writable
package tree against concurrent filesystem replacement. Keep plugin packages and
allowlists administrator-controlled. Acquire disposable resources inside register,
not at module top level, and register rollback before another awaited operation.
Legacy ZeruxCLI.run is now awaitable and accepts `{signal}`; dispose cancels cooperative
runs and releases loaded plugins. Its scheduled addKey behavior still executes once;
existing handlers without a flag schema retain parsed argument compatibility. It
does not automatically stop framework servers that do not use these lifecycle hooks.

Focused checks include malformed flags, separator/aliases, async rejection, terminal
controls, canonical path/symlink denial, plugin conflict/dependency rollback,
cooperative cleanup and an offline npm-installed public declaration consumer. No
live provider or browser is needed. OS signal delivery and third-party plugin
cooperation require testing in the owning deployment; the tests do not certify
all terminals, shells or CLI framework compatibility.

## Shared generator engine and interactive create

`createProjectGenerator(templates)` explicitly registers at most 16 trusted template
functions. Each declares mode/renderer/language combinations; capability validation
is separate from file writing. No installed package scanning, remote template fetch,
shell interpolation, dependency installation or generated-app execution is supplied.
Templates are trusted executable host code, not data or a sandbox. Their returned
file maps are validated even though the functions themselves can have side effects.

`minimalProjectGenerator` supplies the existing minimal Zerux starter through this
engine. Its actual supported matrix is:

| Template        | Mode      | Renderer | Languages                  |
| --------------- | --------- | -------- | -------------------------- |
| `zerux-minimal` | `minimal` | `none`   | `typescript`, `javascript` |

There is no built-in React/Vue/Zyro/CMS/static-export template. Such selections reject
rather than generating files that imply runtime support. Future creator packages
can explicitly register reviewed templates against the same engine and use
`registerGeneratorCommand`. They remain responsible for their actual capabilities,
public imports, licenses and version/runtime qualification.

```sh
zclivo create my-app --yes --language typescript --port 3000 --mode minimal --renderer none
zclivo create --name my-app --destination ./my-folder --js --dry-run
zclivo create --interactive
zclivo create --help
zclivo create --docs
```

Interactive mode is explicit and requires a terminal in the shipped binary. It asks
only for missing template/name/destination/mode/renderer/language/port options, with
choices drawn from registered capabilities. Invalid answers reject; there is no
unbounded reprompt loop. Equivalent flags work without prompts; `--yes` chooses
missing defaults but still requires a destination or name. Without either flag the
existing `create folder`, `--js`, `--ts` and `--dry-run` workflow remains noninteractive.
Mixed language spellings, repeated flags, positional plus flagged destination,
unknown flags and incompatible choices reject. There are no `--install`/`--run`
features; run installation/build commands yourself after reviewing output.

The async binary uses the existing command registry's flag validation, disposal and
status contracts (usage 2, failure 1, cancellation 130). Its entry point alone owns
SIGINT/SIGTERM listeners. `runGeneratorCli` and `registerGeneratorCommand` take
explicit signals and optional per-invocation prompt factories. Prompts are disposed
on success, error and interruption. `createTerminalGeneratorPrompt` lazily owns its
readline interface; imports never touch stdin or process listeners. Legacy synchronous
`runZcli` remains available from the existing binary module with its original short
flag behavior; programmatic creators should use the public async APIs.

### Plans, validation and filesystem ownership

`generator.plan(options)` renders a frozen, bounded `{schema,options,files,digest}`
plan without creating files. It inspects destination availability and parent safety,
so dry-run also refuses existing/dangling targets and missing/unsafe parents. Name
and destination are separate: names preserve display spelling, package names are
lowercase. Names reject hidden/traversal/control/shell syntax, reserved device names
and package/directory collisions such as `node_modules`, `favicon.ico` and `CON`.
Port is an integer in 1–65535. The destination's existing parent must be canonical
and contain no symlink components; use its real path instead of a shortcut.

`writeProjectPlan` preserves synchronous minimal-starter use;
`writeProjectPlanAsync` yields between files to observe cancellation. Only plans
created by this package instance are accepted; serialized JSON is review data, not
write authorization. Rebuild a plan after importing review data. Files are deterministic
for the same template/options; destination location does not change the built-in
file contents/digest. No timestamp, random secret or environment credential is emitted.
The digest is a SHA-256 of the ordered file-map representation, not a signature.

Template output permits at most 128 UTF-8 text files, 256 KiB per file, 2 MiB total
and 16 path components. Absolute/traversal/backslash paths, generated dependency/
VCS directories, file-directory collisions, case-folded collisions, accessors and
non-string contents reject before staging. Binary assets/subprocesses are outside
this engine. The built-in template pins the inspected public `zeruxjs@0.0.4` import,
TypeScript tooling ranges from this repository and Node `>=24.15.0`; native checks
ran on Node 24.15.0. This is a declared starter floor, not all-version/vendor parity
or a guarantee that an unpublished checkout capability exists in a registry release.

Writing stages under the selected parent, claims the target exclusively and checks
parent/target ownership before each step. Files use exclusive creation and promotion
uses `COPYFILE_EXCL`, so a late destination file is never silently overwritten.
Failed writes, promotion or observed abort clean up owned partial target/staging
paths. A target claimed by another writer is preserved. Directory cleanup attempts
both owners even if one cleanup fails; failures remain explicit. New directories are
private (0700), while generated files use 0644. Review deployment permissions later.

This is not an atomic whole-directory publish or a security boundary against another
process with the same account replacing a writable tree between filesystem calls.
Use a trusted parent. Killing the process without cleanup/power loss may leave a
partial target; the next run refuses it rather than guessing it may be deleted.
Synchronous writing cannot observe OS signals while JavaScript is busy; use the async
writer for owned cancellation and await settlement. No force overwrite/cleanup of an
unowned directory is offered.

[Public-import example](examples/generator.mjs) shows planning/writing and shared
command registration. Regression checks include native write/promotion failure,
concurrent target appearance, dangling links/parent links, capability denial,
interactive/flag equivalence, deterministic files and real SIGINT during a controlled
prompt fixture. This is not live interactive-terminal or all-platform certification.
No generated application server or external integration was started by the engine.

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
