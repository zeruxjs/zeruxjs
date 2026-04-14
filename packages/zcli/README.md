> [!WARNING]
> This package is in a very early stage of development and is only published for pre-saving the name from being taken by somebody else. All current versions follow the `0.0.1-alpha.x` pattern.

# zcli


The extensible Command Line Interface toolkit for **ZeruxJS**. `zcli` provides a unified way to define, discover, and execute commands across the framework and its ecosystem.

## Features

- **Automatic Discovery**: Automatically scans `node_modules` for ZeruxJS plugins and loads their commands.
- **Universal Keyword Shared**: Enables multiple packages to share a single CLI entry point (like `zerux`).
- **Rich Formatting**: Built-in support for `chalk` for beautiful, semantic terminal output.
- **Interactive Help**: Automatically generates help documentation and argument lists for all registered commands.
- **ESM Native**: Designed from the ground up for modern ECMAScript Modules.

## Usage

### Registering a Command

```typescript
import { cli } from 'zcli';

cli.addCommand('zerux', 'hello', (args) => {
    const name = args.namedArgs.name || 'World';
    console.log(cli.color.green(`Hello, ${name}!`));
}, {
    description: 'Greet someone from the CLI',
    help: [
        { arg: '--name', 'its description': 'The name to greet' }
    ]
});
```

### Argument Parsing

`zcli` handles complex argument parsing out of the box:

```bash
# Positional args
zerux build ./src

# Named args
zerux dev --port=3000 --host 0.0.0.0

# Boolean flags
zerux test --silent
```

## Plugin System

Any package can add functionality to the `zerux` CLI by defining a `zerux` field in its `package.json` pointing to an initialization script. `zcli` will automatically import these scripts during startup.

```json
{
  "name": "my-zerux-plugin",
  "zerux": "./dist/cli-init.js"
}
```

---

<p align="center">
  Empowering the ZeruxJS Developer Experience.
</p>
