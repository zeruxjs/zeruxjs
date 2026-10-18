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
export const GET = () => redirect("/docs/0.0.2/introduction/", RedirectType.Temporary);
```

## Errors

HttpError and exceptionHandler are public exports. Throw errors through the runtime error path instead of exposing stack traces or secret connection details in custom JSON. Log sufficient diagnostic context while redacting credentials.
