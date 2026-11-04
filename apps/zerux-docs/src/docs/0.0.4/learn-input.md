---
{
  "title": "4. Accept input safely",
  "description": "Validate an unknown request body and separate useful errors from permission checks.",
  "section": "Learning",
  "order": 40,
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

For larger schemas, use [the validator package](package-validator.md) according to its public contract. Keep size/shape checks close to the boundary and pass validated values into application logic. Avoid a type assertion such as `body as User` as a substitute for parsing and validation.

## Try it yourself

Add an optional `language` field with the explicit allowed values `en` and `fr`. Decide what missing and unsupported values mean, implement that policy, and inspect a valid and invalid request. You do not need to load any catalog yet.

**You are done when:** you can demonstrate accepted and rejected input, and explain what would still be needed before a private write is safe.
