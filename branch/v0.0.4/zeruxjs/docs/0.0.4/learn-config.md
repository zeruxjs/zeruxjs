# 3. Make configuration predictable

Understand application scripts, configuration consumers, types and server-only secrets.


## Your goal

Explain which file controls a behavior, configure a simple application and avoid mistaking a declared field for an activated service.

## Three files with different jobs

| File | What it controls | What it does not do |
| --- | --- | --- |
| `package.json` | Dependencies, module mode and npm script commands | Automatically discover a missing build script |
| `zerux.config.ts` / `.js` | Framework options and explicitly consumed application settings | Turn every custom key into a managed service |
| `tsconfig.json` | TypeScript compiler/checker behavior | Validate incoming HTTP JSON |

Keep one active Zerux config. A TypeScript config takes precedence over JavaScript, then `.mjs`, then `.cjs`; they are not merged. A stale higher-priority file can explain why editing another file has no effect.

## Start with a small configuration

```ts title="zerux.config.ts"
import type { ZeruxConfig } from 'zeruxjs';

export default {
  type: 'fix',
  outDir: '.zerux',
  structure: {
    app: 'app',
    middleware: ['middleware'],
    plugins: ['plugins'],
  },
} satisfies ZeruxConfig;
```

This declares discovery/output settings. It does not connect a database or render React components. `type: 'fix'` is a structure mode, not a static-export flag. Use [the configuration handbook](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-handbook.md) when adding a real service.

**JavaScript option:** use the same default-exported object in `zerux.config.js` for an ESM application. Add a JSDoc `@type {import('zeruxjs').ZeruxConfig}` comment for editor help. Do not keep two competing active files.

## Read secrets at the owning server boundary

```ts title="Server-only startup preparation"
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
// Pass it to the documented server-side connector options during startup.
```

The snippet validates presence only; it does not initialize a connector. The actual service setup depends on its documented options. Never print the value, commit a real `.env`, copy it to `public`, or serialize the entire config to the browser.

Environment loading has an order. A file loaded only after config evaluation cannot supply a value already read at module top level. Deployment tools and standalone scripts may load environment values differently. See [environment setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/environment.md) before guessing.

## Know what the build checks

`zerux build` compiles the application; it is not a complete TypeScript typecheck. Configure a separate strict check with the [TypeScript guide](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md). An editor warning and a failing HTTP response are different evidence; resolve each at the correct layer.

## For AI-assisted development

Ask the tool: “Which code consumes this option, and where is that consumer documented?” If it invents a key such as `automaticallyTranslateEverything`, the config type's open index signature does not make the feature exist. Trace the actual startup consumer or use an explicit plugin/factory.

## Try it yourself

Add the small config to the application from lesson 2. Explain what each field changes, start the app, and verify `/api/hello` still works. Find the service setup guide you would use for a database, without adding guessed credentials.

**You are done when:** you can point to the consumer of a setting and distinguish a server secret from public application data.


## Check your understanding

1. Does adding any custom key to zerux.config automatically start a service?
   - 1. Yes, every key becomes a service
   - 2. Only if the key name starts with z
   - 3. No; some keys are consumed by runtime startup, others need your own integration

Answer: No; some keys are consumed by runtime startup, others need your own integration. An open config type permits custom keys; it does not implement their behavior. Follow the documented consumer.

2. Where should a database password come from?
   - 1. A committed browser bundle
   - 2. The server process environment or your deployment secret store
   - 3. A public README screenshot

Answer: The server process environment or your deployment secret store. Read server secrets from process.env and validate them at startup. Never expose them to the client.

Confirm that you tried the lesson exercise. Optional points/progress are stored only by the browser interface.


## Implementation sources

- [apps/zerux-docs/src/lib/academy.mjs](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/apps/zerux-docs/src/lib/academy.mjs)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/types.ts)
- [packages/zlocale/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zlocale/src/index.ts)
