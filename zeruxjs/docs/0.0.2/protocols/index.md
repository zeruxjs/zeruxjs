# Protocols and Fetch handlers

Integrate non-page endpoints with the same runtime.


## Protocol gateway

api.protocols() registers JSON-RPC, MCP tools/resources, Connect and tRPC handlers and publishes SSE events. Gateway routes include /rpc, /mcp, /events and /trpc/<name>. MCP implements a JSON transport subset, not every MCP transport.

## Gateway authorization

Protocol endpoints are local-only by default. Requests carrying proxy forwarding headers are rejected unless protocols.authorize explicitly authorizes them. Set authentication, trusted proxy rules and allowedOrigins for real deployments.

## Fetch integration

registerFetchRoutes and createFetchRoute adapt standard Fetch handlers. The adapter preserves statuses, safe end-to-end headers and streaming cancellation; it does not add authorization.

```ts
import { registerFetchRoutes } from "zeruxjs/fetch-route";
export default (api) => registerFetchRoutes(api, [{
  pattern: "/ping",
  handler: () => Response.json({ ok: true })
}]);
```


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/types.ts)
