# Validation and HTTP input

Validate request bodies and queries with bounded Fetch-compatible adapters.


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


## Public entry points

Manifest reference for `@zeruxjs/validator@0.0.2`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./http": {
      "types": "./dist/integrations/http.d.ts",
      "import": "./dist/integrations/http.js"
    }
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/validator

Schema validation and transformation utilities with synchronous and asynchronous parsers. The library exports its schema constructors and validation actions from the package root.

## Fetch-compatible HTTP adapter

```ts
import { object, string, parseJsonRequest, validatedJsonHandler } from '@zeruxjs/validator';
const schema = object({ name: string() });
const handler = validatedJsonHandler(schema, async (body) => ({ hello: body.name }));
const response = await handler(new Request('https://example.test/api', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({name:'Maya'}) }));
```

`readJsonBody` streams up to 1 MiB by default, rejecting invalid media types, malformed JSON and oversized payloads; `parseJsonRequest` and `parseQuery` validate with both synchronous and asynchronous schemas. `HttpValidationError.toResponse()` emits bounded error details and `Cache-Control: no-store`. Do not disclose raw input in external API errors. Use `maxBytes`/`maxQueryFields` to set explicit caps. This adapter works with the Web Fetch `Request` API and can be used by ZeruxJS route handlers or other framework integrations.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Implementation sources

- [packages/@zeruxjs/validator/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/validator/README.md)
- [packages/@zeruxjs/validator/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/validator/package.json)
