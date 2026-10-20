# 1. Understand what you are building

Learn browser, server, request, response and package concepts with one concrete example.


## Your goal

Explain what happens when someone opens a page, and choose which part of the ecosystem is responsible for each step. No terminal work is required in this lesson.

## Start with a familiar interaction

You enter a shop, ask for a product, and receive an answer. On the web, your browser sends a **request** to a **server**. The server runs a **handler** and sends a **response**. The response might be an HTML page, JSON data or a deliberate error.

```text
Browser → GET /welcome → ZeruxJS route handler → response → Browser
```

`GET` is the HTTP method: it describes the kind of request. `/welcome` is the path: it identifies the resource. A route connects a method/path to the code that answers it. JSON is a data format; HTML describes a page. Neither automatically gives a route authentication or a database.

## Put each tool in its place

| Layer | Responsibility | Example |
| --- | --- | --- |
| ZeruxJS | Node server runtime, route discovery and application lifecycle | Answer GET /api/hello |
| ZyroJS | Reactive browser/UI primitives | Update a visible greeting when state changes |
| zlocale | Translation data and locale formatting | Display Bonjour or format a price |
| Database adapter | Connect to persistent storage | Keep records after restart |
| Your application | Product rules, user permissions and ownership | Decide who may read a private note |

A **package** is installable code with a public import contract. Installing one does not automatically connect every feature. A **framework** coordinates application behavior; a **library** provides functions your application calls. Read each package's documented integration path.

## What code is running where?

```ts title="A conceptual handler; the next lesson supplies its real file path"
/** Answer a public greeting. @returns JSON-shaped data. No globals or services. */
export function GET() {
  return { message: 'Hello from the server' };
}
```

This function runs on the server. It returns data. The browser does not receive your entire server process, environment or source files. Conversely, code put in a browser bundle is visible to the visitor; do not put a database password there.

**Expected result:** when a real route invokes this handler, the response contains `message`. Nothing in this snippet creates a database, reads a cookie or installs dependencies.

## If you use an AI coding tool

Ask for one change with a verifiable outcome: “Add GET /api/hello that returns a greeting. Explain the new file and give a command to inspect its response.” Review the file location and imports. Run the application. Inspect the response. Ask why the result differs if it fails; do not repeatedly add libraries without understanding the failure.

Treat generated code as a draft. A correct-looking type is not runtime validation. An error disappearing is not evidence that authorization works. Do not ask a tool to publish credentials, disable checks or expose a private database just to make a demo appear successful.

## Try it yourself

Draw the browser → route → response flow for a weather page. Label where a private API credential should live and where the public weather text appears. Explain why the credential must not be inside a browser JavaScript file.

**You are done when:** you can describe the request, the handler and the response without saying that installing a package “does everything.”

## When you get stuck

Use [the glossary](/branch/v0.0.4/zeruxjs/docs/0.0.4/glossary.md) for individual words. Read [the mental model](/branch/v0.0.4/zeruxjs/docs/0.0.4/mental-model.md) for runtime details. Continue to [your first route](/branch/v0.0.4/zeruxjs/docs/0.0.4/learn-first-route.md) to run this idea.


## Check your understanding

1. You open /welcome in a browser. What does a server handler do?
   - 1. Installs npm packages for the visitor
   - 2. Receives the request and returns a response
   - 3. Automatically creates a database

Answer: Receives the request and returns a response. A handler runs on the server and returns content, data or an error for that request.

2. Which tool handles reactive browser UI?
   - 1. ZyroJS
   - 2. The database connector
   - 3. An npm organization

Answer: ZyroJS. ZyroJS supplies browser UI primitives. ZeruxJS coordinates the server runtime.

Confirm that you tried the lesson exercise. Optional points/progress are stored only by the browser interface.


## Implementation sources

- [apps/zerux-docs/src/lib/academy.mjs](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/apps/zerux-docs/src/lib/academy.mjs)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/types.ts)
- [packages/zlocale/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zlocale/src/index.ts)
