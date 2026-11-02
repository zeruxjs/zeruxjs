# MCP lives in zhost

Use the existing protocol owner instead of a separate MCP package.


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

The JSON POST MCP tools/resources/initialize/ping subset is not full MCP transport/vendor parity. See [zhost](/branch/v0.0.4/zeruxjs/docs/0.0.4/reference-zhost.md) for the actual capability matrix and cooperative cancellation/teardown limits. Native gRPC and HTTP/2 forwarding are distinct, and a declared transport name is not an implemented adapter.

## Migration checklist

Remove the old package dependency/import from your own application and use only the current public zhost entries. Recheck handler argument/result shapes and host policies against their declarations, then test your deployed transport. This repository's manifests, lockfile and source consumers contain no remaining dependency on the removed package. Historical archived references, if any, describe their own versions and are not rewritten as current APIs.


## Implementation sources

- [packages/zhost/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zhost/package.json)
- [packages/zhost/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zhost/src/index.ts)
- [packages/zhost/src/protocols/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zhost/src/protocols/index.ts)
- [packages/zhost/src/protocols/mcp/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zhost/src/protocols/mcp/index.ts)
- [packages/zeruxjs/src/protocols.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/protocols.ts)
