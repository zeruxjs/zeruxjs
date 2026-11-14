---
{
  "title": "Template variables",
  "description": "Interpolate bounded scalar values with explicit HTML escaping and generation ownership.",
  "section": "Frontend",
  "order": 30,
  "sources": [
    "packages/zeruxjs/src/variables.ts"
  ],
  "related": [
    "frontend",
    "package-email",
    "plugins"
  ]
}
---

## Create a registry

```ts
import { createVariableRegistry } from 'zeruxjs';
const renderer = createVariableRegistry();
const unregister = renderer.register('brand.name', () => 'Example');
const html = await renderer.render('<h1>{{brand.name}}</h1><p>{{user.name}}</p>',
  { user: { name: 'Ada & Co' } }, { escape: 'html', missing: 'error' });
unregister();
```

Registries resolve dotted paths against own properties and registered resolver functions. Only scalar values are rendered; objects must be transformed intentionally. Forbidden prototype paths are rejected. Templates do not execute JavaScript expressions.

## Escaping is explicit

HTML escaping must be requested for HTML fields. Plain text interpolation is appropriate for email subject/text fields, not HTML markup. HTML escaping does not validate a URL, CSS token or JavaScript string embedded in another syntax. Do not put user-controlled values into dangerous HTML contexts.

## Several fields, one snapshot

renderFields accepts a bounded map of fields and per-field escape modes. It evaluates a named variable once per render snapshot, including asynchronous resolvers, so subject/HTML/text can agree. Set missing to empty, keep or error and define a maximum output budget.

## Ownership and concurrency

Prefer api.variables() for a generation-scoped registry or create an explicit registry per application/tenant. The exported convenience singleton is process-scoped and can cross application boundaries if used carelessly. Resolvers should derive user-specific values from the supplied verified context rather than mutable globals.

## Limits

The implementation bounds field counts, template lengths, variable counts and output size. These limits prevent accidental unbounded interpolation but do not authorize access to a field. Register only values the recipient is permitted to see.
