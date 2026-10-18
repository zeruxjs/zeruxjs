# Protocol gateway configuration

Configure protocol enablement, origins, body limits and explicit authorization.


## Enable only the gateway you intend to expose

```ts title="zerux.config.ts"
import type { ZeruxConfig } from 'zeruxjs';
const protocols = {
  enabled: true,
  allowedOrigins: ['https://app.example.com'],
  maxBodyBytes: 65536,
  mcp: { name: 'application-tools', version: '1.0.0' },
  authorize: async () => false,
} satisfies NonNullable<ZeruxConfig['protocols']>;
export default { protocols } satisfies ZeruxConfig;
```

Replace the deny-all callback only with a real request authentication/authorization policy. Protocol callbacks receive the Node request shape used by the gateway, not automatically a Fetch Request. Code that calls `request.headers.get()` on a Node IncomingMessage is using the wrong type; use the declared callback input.

## Configuration versus registration

`enabled: false` prevents the application from obtaining the protocol gateway through runtime registration. A configured object alone is not a list of executable tools; the application registers RPC/Connect/tRPC methods, MCP tools/resources and events using its plugin/runtime APIs. The MCP name/version identifies the server; it does not publish the service to an external registry.

The runtime facade creates the gateway lazily when application code requests it. Origins constrain browser/protocol traffic but do not identify a user. Default authorization in the facade is loopback-oriented when no callback is supplied; production exposure should provide an explicit policy and network boundary rather than inheriting local development assumptions.

## Limits and handler safety

Bound `maxBodyBytes`, validate tool input schemas, authorize each operation/resource and restrict outbound effects. A model-generated tool request is untrusted input. Do not expose filesystem, SQL or shell access by forwarding arbitrary arguments into a handler. Register only the intended operations and unregister them with the owning plugin/runtime lifetime.

## Types and cleanup

Infer callback input from `NonNullable<ZeruxConfig['protocols']>['authorize']` instead of substituting a different request type. Exported `ZeruxProtocols` methods return disposers for registrations; preserve and call them during plugin teardown. The gateway owns connections/listeners through its close lifecycle. Verify disallowed origins, unauthorized calls, malformed bodies and size limits using the actual transport rather than only calling a handler directly.

## Exact option shapes

The fields below come from the current source declarations. Optional is not a default value. A callback is application code, not a string naming a role.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/services.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/services.ts)
