---
{
  "title": "Build your first application",
  "description": "Create a small notes API, validate requests, and compile it for production.",
  "section": "Getting started",
  "order": 15,
  "sources": [
    "packages/zeruxjs/src/bootstrap/runtime.ts",
    "packages/zeruxjs/src/commands/project-builder.ts",
    "packages/zeruxjs/src/exceptions/http_error.ts"
  ],
  "related": [
    "routing",
    "fetch-handlers",
    "database-queries"
  ]
}
---

This walkthrough uses the actual file-route runtime. It deliberately starts with an in-memory store so you can understand routing before configuring external services. By the end, you will have a page, an API, input validation, request state and a production build.

## 1. Create the project

The current `create-zerux-js` release does not scaffold projects. Create a directory manually and install the runtime:

```sh
mkdir notes-app
cd notes-app
npm init -y
npm pkg set type=module
npm install zeruxjs@0.0.3 @zeruxjs/typescript@0.0.3
mkdir -p app/api/notes middleware lib
```

Add scripts to your application `package.json`:

```json
{
  "scripts": {
    "dev": "zerux dev",
    "build": "zerux build",
    "start": "zerux start"
  }
}
```

## 2. Return a complete page

A page handler returns a value; Zerux decides how to serialize it. For a simple HTML page, return the complete document yourself.

```ts title="app/page.ts"
/** Render the landing page. @returns A complete HTML document. No globals. */
export default function home() {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Notes</title></head>
<body><main><h1>Notes API</h1><a href="/api/notes">View notes</a></main></body>
</html>`;
}
```

This is server-rendered HTML. It does not imply React component rendering, layout composition or client hydration.

## 3. Add a bounded teaching store

```ts title="lib/notes.ts"
import { randomUUID } from 'node:crypto';

const notes = new Map<string, { id: string; title: string }>();

/** Read all notes. @returns Defensive record copies. Reads module-local notes. */
export function listNotes() {
  return [...notes.values()].map(note => ({ ...note }));
}

/** Add a note. @param title Validated title. @returns Created record or null at capacity. Mutates module-local notes. */
export function addNote(title: string) {
  if (notes.size >= 100) return null;
  const note = { id: randomUUID(), title };
  notes.set(note.id, note);
  return { ...note };
}
```

> This store is shared within one process and disappears on restart or reload. It has no user isolation and is only for this tutorial. Use an authenticated, tenant-scoped database for real notes.

## 4. Implement method handlers

```ts title="app/api/notes/route.ts"
import { HttpError, type ZeruxRequestContext } from 'zeruxjs';
import { addNote, listNotes } from '../../../lib/notes.js';

/** List tutorial notes. @returns JSON payload. Reads the process-local note store. */
export function GET() {
  return { notes: listNotes() };
}

/** Validate and create a note. @param context Request body and logger context. @returns Created note. Mutates the process-local store. */
export function POST(context: ZeruxRequestContext) {
  const body = context.body;
  if (!body || typeof body !== 'object' || !('title' in body) ||
      typeof body.title !== 'string' || !body.title.trim() || body.title.length > 120) {
    throw new HttpError(400, 'title must be a nonempty string of at most 120 characters');
  }
  const note = addNote(body.title.trim());
  if (!note) throw new HttpError(409, 'Tutorial store is full');
  return { note };
}
```

An object return becomes JSON. To control a full HTTP status/header contract with Web APIs, use the [Fetch bridge](fetch-handlers.md) and return a `Response`. Throw `HttpError` for deliberate failures through the standard error path.

## 5. Observe a request without leaking secrets

```ts title="middleware/timing.ts"
import type { ZeruxRequestContext } from 'zeruxjs';

/** Time downstream handlers. @param context Request state/logger. @param next Next middleware. @returns Completion. Reads the clock only. */
export default async function timing(context: ZeruxRequestContext, next: () => Promise<void>) {
  const startedAt = performance.now();
  await next();
  context.logger.info(`Request completed in ${Math.round(performance.now() - startedAt)}ms`);
}
```

Await `next()` so timing includes the downstream work. Do not log complete request bodies, environment objects, cookies or credentials.

## 6. Exercise the API

Start `npm run dev` and use the address printed by the CLI. In another terminal:

```sh
curl http://localhost:3000/api/notes
curl -X POST http://localhost:3000/api/notes \
  -H 'content-type: application/json' \
  --data '{"title":"Read the routing guide"}'
curl http://localhost:3000/api/notes
```

The first list is empty, POST returns a generated ID, and the next list includes the record. An empty title produces an error. If your chosen port differs, update the URL.

## 7. Build and run the compiled application

```sh
npm run build
npm run start
```

`zerux build` compiles application sources; it does not perform TypeScript typechecking. The production application still needs Node and its dependencies. This is different from this documentation site's static export.

## Continue the application

Replace the teaching store with [database access](database-queries.md), add [authentication](package-auth.md), and cache only public or appropriately scoped results with [cache](package-cache.md). Before production, define ownership, authorization, durable persistence and operational limits.
