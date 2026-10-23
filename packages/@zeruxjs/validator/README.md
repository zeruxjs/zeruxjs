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
