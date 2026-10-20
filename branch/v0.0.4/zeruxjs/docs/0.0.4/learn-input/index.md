# 4. Accept input safely

Validate an unknown request body and separate useful errors from permission checks.


## Your goal

Add a small POST endpoint that accepts a bounded name, rejects invalid input and returns an explicit useful result. This teaching endpoint is public and performs no persistent write.

## Treat incoming data as unknown

A browser can send JSON that does not match your interface. A user can bypass your form. TypeScript annotations disappear before runtime, so check the received value before using it.

```ts title="app/api/greet/route.ts"
import { HttpError, type ZeruxRequestContext } from 'zeruxjs';

/** Validate a small public greeting request. @param context Untrusted request body. @returns JSON greeting. No database, cookies, environment or global mutable state. */
export function POST(context: ZeruxRequestContext) {
  const body: unknown = context.body;
  if (!body || typeof body !== 'object' || !('name' in body) ||
      typeof body.name !== 'string') {
    throw new HttpError(400, 'name must be a string');
  }
  const name = body.name.trim();
  if (!name || name.length > 80) {
    throw new HttpError(400, 'name must contain 1 to 80 characters');
  }
  return { greeting: `Hello, ${name}` };
}
```

**Expected behavior:** a valid name returns JSON; missing, non-string, blank or oversized values produce a deliberate 400 error through the standard error path. Do not expose stack traces, secret config or full request bodies in a public error response.

## Exercise both outcomes

Use the actual server address printed by your application:

```sh
curl -X POST http://localhost:3000/api/greet -H 'content-type: application/json' --data '{"name":"Ada"}'
curl -X POST http://localhost:3000/api/greet -H 'content-type: application/json' --data '{"name":""}'
```

The valid response contains `Hello, Ada`. The blank request fails. Shell quoting differs across operating systems; if the tool changes your JSON, use an HTTP client that lets you inspect the actual request body.

## Validation is only one boundary

If this endpoint later writes a private profile or note, it also needs authentication, authorization for the affected user/tenant, body-size policy, CSRF/origin policy where relevant and safe output handling. A nonempty name is not evidence that a user owns a record.

The greeting is JSON text. If a UI renders it into HTML, use text nodes or the renderer's escaping. Do not insert arbitrary text with innerHTML just because the server validated its length. Validate URL contexts separately.

## Add reusable validation when it earns its place

For larger schemas, use [the validator package](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-validator.md) according to its public contract. Keep size/shape checks close to the boundary and pass validated values into application logic. Avoid a type assertion such as `body as User` as a substitute for parsing and validation.

## Try it yourself

Add an optional `language` field with the explicit allowed values `en` and `fr`. Decide what missing and unsupported values mean, implement that policy, and inspect a valid and invalid request. You do not need to load any catalog yet.

**You are done when:** you can demonstrate accepted and rejected input, and explain what would still be needed before a private write is safe.


## Check your understanding

1. Does a TypeScript annotation validate incoming JSON?
   - 1. No; runtime validation is still required
   - 2. Yes, in all browsers
   - 3. Only when the interface is exported

Answer: No; runtime validation is still required. Type annotations are removed. Validate the shape, size and allowed values of data at runtime.

2. A valid note ID was supplied. What else may a private route need?
   - 1. A longer variable name
   - 2. Authentication and authorization for that note/tenant
   - 3. A public cache header

Answer: Authentication and authorization for that note/tenant. Well-shaped input is not permission. Verify identity and ownership before reading or modifying private records.

Confirm that you tried the lesson exercise. Optional points/progress are stored only by the browser interface.


## Implementation sources

- [apps/zerux-docs/src/lib/academy.mjs](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/apps/zerux-docs/src/lib/academy.mjs)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/types.ts)
- [packages/zlocale/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zlocale/src/index.ts)
