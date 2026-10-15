# ZCLI — composable CLI toolkit

Command registry and explicit plugin discovery for ZeruxJS, ZyroJS, and other JavaScript applications. **This is an evolving 0.x package.** Commands can be shared under a common keyword without requiring plugins to mutate a global command map or immediately call `process.exit()`.

## Programmatic command registry

```ts
import { CommandRegistry } from 'zcli';

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

`import { cli } from 'zcli'` still exposes `cli.addKey(keyword, {func,description})` and `cli.addCommand(keyword, name, handler, options)` with the same parsed argument structure. Legacy handlers no longer cause an immediate `process.exit()`; set `process.exitCode` if an explicit exit status is needed. Asynchronous development servers continue to run while they have active handles.

## Validation

```sh
npm run build
node --test test/*.test.mjs
```
