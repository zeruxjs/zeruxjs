# Environment variables

Load server configuration with explicit precedence and no implicit client exposure.


## Files and precedence

The default resolver considers .env, .env.local, then environment-specific files and their local variants, using NODE_ENV or the lifecycle's default environment. Additional structure.env paths extend the set.

The current loader sets process.env only when a key is undefined. **The first value encountered wins**, including a value already present in the process. Do not assume later .local files override earlier keys as in other frameworks. Configure deployments through the process environment and verify precedence for your application.

## Parsing scope

The built-in parser skips comments/empty lines, splits at the first equals sign, removes matching surrounding quotes and converts escaped newline sequences. It is a small parser, not a full shell evaluator. Do not assume variable expansion, command substitution or every dotenv syntax extension.

## Read at the right time

Use process.env for private configuration and context.env inside request code. Configuration and module-evaluation timing can matter when a value must be available before a manager is constructed. Avoid importing an eager client before the required environment is initialized.

```ts
/** Read required server configuration. @param name Environment key. @returns Nonempty value. Reads process.env; never logs it. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment key: ${name}`);
  return value;
}
```

## Server/client boundary

Zerux does not make arbitrary process.env values safe for the browser. Never return context.env or whole startup config objects. Create an explicit allowlist of nonsecret public settings when a page needs them. Secret values must not enter documentation examples, snapshots, public assets or request logs.

## Rotation and operations

Changing an environment value does not necessarily recreate an existing client or decrypt old data. Restart/rebuild the relevant lifecycle generation and follow each service's key-rotation procedure. Tracking signing-key rings, password salts and session encryption keys have different compatibility implications.


## Implementation sources

- [packages/zeruxjs/src/bootstrap/env.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/env.ts)
- [packages/zeruxjs/src/bootstrap/config.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/config.ts)
- [packages/zeruxjs/src/commands/server.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/commands/server.ts)
