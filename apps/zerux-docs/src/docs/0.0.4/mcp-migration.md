---
{
  "title": "MCP lives in zhost",
  "description": "Use the existing protocol owner instead of a separate MCP package.",
  "navigation": "guide",
  "section": "Runtime",
  "order": 108,
  "sources": [
    "packages/zhost/package.json",
    "packages/zhost/src/index.ts",
    "packages/zhost/src/protocols/index.ts",
    "packages/zhost/src/protocols/mcp/index.ts",
    "packages/zeruxjs/src/protocols.ts"
  ],
  "related": [
    "protocols",
    "configuration-protocols",
    "reference-zhost"
  ]
}
---

## Current package boundary

There is no separate `@zeruxjs/mcp` workspace or dependency. Its supported protocol APIs live in `zhost`, available through the root and explicit `zhost/protocols` export. ZeruxJS already consumes `zhost/protocols`; do not add a replacement MCP package or install the removed name.

```js
import { createMcpServer, createProtocolGateway } from 'zhost/protocols';
const mcp = createMcpServer({ name: 'public-tools', version: '1.0.0' });
mcp.tools.register({
  name: 'public_status',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: () => ({ ready: true }),
});
const gateway = createProtocolGateway({
  mcp, maxBodyBytes: 16384,
  allowedOrigins: ['https://app.example.test'],
  authorize: async () => false, // replace only with real host authentication/authorization
});
try {
  // Bind this explicitly through the owning zhost host/proxy integration.
  // Creating a gateway alone opens no listener and grants no tool authorization.
} finally {
  gateway.close();
}
```

## Framework consumers

Within a trusted ZeruxJS plugin, `api.protocols()` supplies its existing facade. Register only allowlisted tools/resources and retain registration disposers for reload. Private protocol configuration must provide host authorization, exact allowed origins and bounded input. A tool schema is not permission to execute filesystem/network/shell operations, and a model's request is untrusted data.

The JSON POST MCP tools/resources/initialize/ping subset is not full MCP transport/vendor parity. See [zhost](reference-zhost.md) for the actual capability matrix and cooperative cancellation/teardown limits. Native gRPC and HTTP/2 forwarding are distinct, and a declared transport name is not an implemented adapter.

## Migration checklist

Remove the old package dependency/import from your own application and use only the current public zhost entries. Recheck handler argument/result shapes and host policies against their declarations, then test your deployed transport. This repository's manifests, lockfile and source consumers contain no remaining dependency on the removed package. Historical archived references, if any, describe their own versions and are not rewritten as current APIs.
