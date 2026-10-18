# Installation

Run an existing application before adding features.


## Prerequisites

Use a supported Node.js version satisfying the engines field of your installed packages. CI exercises Node 22 and 24. Install dependencies with npm and keep the lockfile committed.

## Install the runtime

For an existing ESM Node application, add the framework. The project generator is reserved and does not scaffold projects yet.

```sh
npm install zeruxjs@0.0.3 @zeruxjs/typescript@0.0.3
```

## Create your first route

Create app/page.ts. A route can return a full HTML document. Strings are not automatically escaped; escape untrusted values before putting them into HTML.

```ts
export default () => `<!doctype html>
<html lang="en"><head><title>Hello Zerux</title></head>
<body><h1>Hello, ZeruxJS</h1></body></html>`;
```

## Run locally

Run these commands in the application directory. Development uses working sources; production start uses the compiled build.

```sh
npx zerux dev
# In a separate build/deployment step:
npx zerux build
npx zerux start
```

## Complete package scripts and checking

Set `type` to `module` in package.json for ESM `.js` files. A small application should keep development, build, production startup and typechecking as separate commands:

```json
{
  "type": "module",
  "scripts": {
    "dev": "zerux dev",
    "build": "zerux build",
    "start": "zerux start",
    "typecheck": "tsc --noEmit"
  }
}
```

Install TypeScript and Node declaration packages as development dependencies when using the checker. The framework compiler's successful output is not a semantic typecheck. The [TypeScript guide](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) includes the strict NodeNext project configuration and explains why browser libraries belong only in the entry points that use them.

## Add configuration before infrastructure

Create one `zerux.config.js` or `zerux.config.ts` at the app root. Begin with structure/host settings and a memory cache only if the application needs caching. Then add an actual database adapter using [database configuration](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-database.md). A memory store in a tutorial disappears on restart and is not a production persistence plan.

Keep private files outside public directories. Pass credentials through the server environment and validate required values at startup. Do not add every optional backend before the first route runs: first verify a plain response, then the service that route needs, then the production artifact.

## Confirm the installed contract

An external project uses the package version installed from npm, whereas this monorepo links its checked-out workspace packages. If an example uses a newly added API, confirm the installed version and export map first. Importing internal source files to bypass a missing public export creates an unstable dependency.

On a new machine, use the committed lockfile with a clean install, build the application and run production startup. Check host routing, public assets and a deliberate 404. If startup fails, distinguish a missing config/entry file, module format mismatch, unavailable service and incompatible Node/native driver before changing several settings at once.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/types.ts)
