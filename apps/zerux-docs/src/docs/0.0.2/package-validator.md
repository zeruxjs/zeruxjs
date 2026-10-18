---
{
  "title": "Validation and HTTP input",
  "description": "Validate request bodies and queries with bounded Fetch-compatible adapters.",
  "section": "Packages",
  "order": 11,
  "sources": [
    "packages/@zeruxjs/validator/README.md",
    "packages/@zeruxjs/validator/package.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/validator"
}
---

## Define the schema once

```ts
import { object, string, validatedJsonHandler } from '@zeruxjs/validator';
const schema = object({ name: string() });
const handler = validatedJsonHandler(schema, async body => ({ hello: body.name }));
```

Schema constructors and synchronous/asynchronous parsing actions are exported from the root. Choose a schema that represents the operation's allowed input, not an entire database object with private fields.

## Framework registration

Pass the handler to registerFetchRoutes from zeruxjs/fetch-route. The bridge preserves its HTTP response contract and avoids reading a body twice. Normal Zerux route context.body is already parsed; do not pass an already-consumed Node stream to a second request parser.

## Input bounds

`readJsonBody` defaults to a 1 MiB cap and checks media type, malformed JSON and length. `parseJsonRequest` and `parseQuery` apply schemas. Configure maxBytes/maxQueryFields for the endpoint's budget. A large schema or asynchronous validation can still perform expensive work, so avoid unbounded external lookups per field.

## Errors and authorization

`HttpValidationError.toResponse()` gives bounded details and no-store headers. Do not disclose rejected secrets or complete raw inputs. Validation is not authorization: verify identity, tenant ownership and write permission before committing data.
