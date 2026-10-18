# Installation

Run an existing application before adding features.


## Prerequisites

Use a supported Node.js version satisfying the engines field of your installed packages. CI exercises Node 22 and 24. Install dependencies with npm and keep the lockfile committed.

## Install the runtime

For an existing ESM Node application, add the framework. The project generator is reserved and does not scaffold projects yet.

```sh
npm install zeruxjs@0.0.2 @zeruxjs/typescript@0.0.2
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


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/types.ts)
