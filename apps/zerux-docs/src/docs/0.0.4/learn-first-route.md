---
{
  "title": "2. Run your first route",
  "description": "Create an application manually, run one JSON endpoint and inspect the actual result.",
  "section": "Learning",
  "order": 20,
  "sources": [
    "apps/zerux-docs/src/lib/academy.mjs",
    "packages/zeruxjs/src/bootstrap/types.ts",
    "packages/zlocale/src/index.ts"
  ],
  "related": [
    "learn",
    "solutions",
    "glossary"
  ]
}
---

## Your goal

Run a small application and verify a real response. Use a terminal—a window for running commands—and an editor to change the listed files. Commands here run in your new application directory, not in the ZeruxJS monorepo root.

## Check the prerequisite

Use a Node version supported by the installed packages; Node 24 is a practical example for this walkthrough. Verify what is installed:

```sh
node --version
npm --version
```

If either command is missing, install Node/npm using the official instructions for your operating system before continuing. No browser code or package can install the Node server runtime for you.

## Create a directory and install dependencies

```sh
mkdir hello-zerux
cd hello-zerux
npm init -y
npm pkg set type=module
npm install zeruxjs@0.0.3 @zeruxjs/typescript@0.0.3
npm pkg set scripts.dev="zerux dev" scripts.build="zerux build" scripts.start="zerux start"
```

The creator packages are currently placeholders; this course creates files manually. The npm commands edit your application's `package.json`. The lockfile records dependency resolutions. Commit source/lockfiles to your project, but never private environment values.

## Create the route file

In your editor, create directories `app`, `app/api`, `app/api/hello`, then this file:

```ts title="app/api/hello/route.ts"
/** Return a public greeting. @returns JSON payload. Reads no globals, request data or services. */
export function GET() {
  return { message: 'Hello, ZeruxJS', ready: true };
}
```

A named `GET` export answers GET requests at this discovered route. Do not put the file in `public`: public files are served as assets, not discovered as handler modules.

## Start and inspect

```sh
npm run dev
```

Keep this terminal running. Open the server address printed by the CLI, adding `/api/hello`. If the printed address is `http://localhost:3000`, use the following in a second terminal (PowerShell users may prefer `curl.exe`):

```sh
curl http://localhost:3000/api/hello
```

```json title="Expected JSON fields"
{"message":"Hello, ZeruxJS","ready":true}
```

Formatting/whitespace can differ; the JSON fields are the contract. The server must actually be running. Do not guess the port if the CLI prints another one.

## Make a controlled change

Change the greeting string, save, and request the same route again. Verify the response changed. If not, check the server terminal, actual file path, filename casing and whether you edited the project that is running.

## A deliberate failure teaches you more

Open a nonexistent address such as `/api/not-a-route`. Expect a missing-route response, not your greeting. Restore the valid URL. Learning to distinguish “server not running,” “route not found” and “handler threw” makes debugging much faster.

## Try it yourself

Add `app/api/status/route.ts` with a GET function returning `{ status: 'learning' }`. Inspect both routes independently. Explain why changing `/api/status` should not change `/api/hello`.

**You are done when:** the valid endpoint returns the expected JSON, your change is visible and a nonexistent endpoint does not pretend to succeed.

## Find the next detail

See [file conventions](file-conventions.md), [routing](routing.md) and the [full notes tutorial](tutorial.md). If npm reports a missing script, use [the solution finder](solutions.md) rather than reinstalling arbitrary packages.
