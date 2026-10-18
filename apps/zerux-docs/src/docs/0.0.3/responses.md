---
{
  "title": "Responses and errors",
  "description": "Return HTML, JSON, redirects and deliberate error responses.",
  "section": "Fundamentals",
  "order": 60,
  "sources": [
    "packages/zeruxjs/src/index.ts",
    "packages/zeruxjs/src/bootstrap/types.ts"
  ],
  "related": [
    "introduction",
    "deployment"
  ]
}
---

## Response values

Objects serialize to JSON. HTML-looking strings receive an HTML content type. Buffers can be returned for binary payloads. Headers and status can be managed through the underlying response when a custom integration requires it.

## Redirects

Import redirect and RedirectType from zeruxjs/navigation. Temporary is 307, Permanent 308, Found 302 and SeeOther 303.

```ts
import { redirect, RedirectType } from "zeruxjs/navigation";
export const GET = () => redirect("/docs/0.0.3/introduction/", RedirectType.Temporary);
```

## Errors

HttpError and exceptionHandler are public exports. Throw errors through the runtime error path instead of exposing stack traces or secret connection details in custom JSON. Log sufficient diagnostic context while redacting credentials.

## Choose a serialization and status contract

An ordinary object return is useful for JSON, but an object type does not choose all HTTP status/header semantics. Use a Fetch bridge and Response when you need a complete Web response contract, or the documented runtime response helpers for redirects, bounded streaming and caching. Avoid mixing a manually ended Node response with another returned response value.

```ts
import { redirect, RedirectType } from 'zeruxjs/navigation';
export function POST() {
  // After a successful, authorized mutation, redirect to a read page.
  return redirect('/items', RedirectType.SeeOther);
}
```

303 changes the follow-up to a retrieval request, while 307/308 preserve method semantics. A redirect target derived from input needs an approved same-origin/allowlist policy; a typed string is not an open-redirect defense.

## Content, escaping and privacy

HTML-looking strings are not automatically sanitized. Escape user text and script-embedded JSON with the appropriate helper; HTML escaping and URL validation are different operations. An error response must not include connection passwords, raw tokens or stack traces. Preserve deliberate public status/error messages while logging a redacted diagnostic context server-side.

Cache headers belong to the response's privacy model. Personalized responses should not become public merely because they are successful. A cached payload can outlive session changes; validate authorization before returning it and include tenant/data-version boundaries in cache keys. See [cache/stream responses](cache-streams.md) for header and cancellation details.

## TypeScript and failure handling

Use the exported response/stream policy types or infer an option type from the helper signature. Type checking cannot know whether headers have already been sent or a network consumer disconnected. Test GET and HEAD, deliberate HttpError, unsupported method, cancellation, redirects and conditional responses through the real runtime.

A stream failure after headers are committed cannot always be converted into a fresh JSON error response. Make error and cleanup behavior explicit at the stream owner. Keep error serialization consistent so callers can distinguish invalid input, denied access, missing resources and infrastructure failure without parsing private log text.
