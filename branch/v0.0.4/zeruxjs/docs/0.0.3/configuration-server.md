# Server, hosts and development tools

Understand implemented listener options, host matching, CLI precedence and compatibility-only fields.


## Configure the listener and host policy

```js title="zerux.config.js"
/** @type {import('zeruxjs').ZeruxConfig} */
export default {
  server: {
    port: 3000,
    allowedDomains: ['app.example.com', '*.preview.example.com'],
    allowedDevDomain: 'local.example.test',
  },
  devtools: { modules: [] },
};
```

Use explicit deployment hosts. A wildcard subdomain pattern matches subdomains, not the bare apex automatically. The runtime accepts discovered local addresses and localhost names independently of this allowlist. Do not use an allowlist as proof of user authentication or as the only boundary protecting an internal admin service.

The server command selects the application port from CLI `-p` / `--port` before `server.port`. Host checks prefer nested `server.allowedDomains` and `server.allowedDevDomain` over their top-level legacy aliases. Avoid configuring both locations: reviewers should be able to see one authoritative policy.

## Values and implementation boundaries

`allowedDomains` accepts one string or an array. Prefer arrays for clarity. Patterns can include an exact hostname, `*.suffix` or the unrestricted `*`; do not use unrestricted matching for an application that expects a fixed public host. Scheme/path/user-info syntax is not a hostname policy. The runtime normalizes host casing and ports before checking requests.

`server.devPort` and the root `websocket` object's fields are present in the public shape, but the current core server startup does not directly consume them as a universal listener/socket policy. Check the actual zhost/devtools integration and [CLI reference](/branch/v0.0.4/zeruxjs/docs/0.0.3/cli-reference.md) before assuming those fields change behavior. A permissive config interface is not feature detection.

## Development modules

`devtools.modules` accepts package-name strings or objects with `package`, `enabled` and `options`. Only load trusted developer modules. These packages can contain executable Node code; a string identifier is not a sandbox. Keep admin/devtools exposure restricted to its intended environment and network.

```ts
import type { ZeruxConfig } from 'zeruxjs';
const modules = [] satisfies NonNullable<ZeruxConfig['devtools']>['modules'];
export default {
  server: { port: 3000, allowedDomains: ['app.example.com'] },
  devtools: { modules },
} satisfies ZeruxConfig;
```

The development module option type is a bag passed to the module, not validated business data. A module's own package defines its actual option values and permissions. Do not put secrets into metadata later rendered by a development UI.

## Deployment and troubleshooting

A configured hostname does not create a DNS record, obtain TLS, configure a reverse proxy or open a firewall. Configure the hosting layer separately and test the forwarded Host header. If an allowed request is rejected, compare the actual hostname, nested-versus-root precedence, wildcard apex behavior and any reverse-proxy rewriting. Avoid logging authorization headers or cookies while diagnosing it.

Test the same host policy in production mode, where compiled application structure is used. Keep the application bound to the intended network interface and expose only the proxy/listener you need. A static GitHub Pages export has no Node listener and does not use these runtime host checks.

## Exact option shapes

The fields below come from the current source declarations. Optional is not a default value. A callback is application code, not a string naming a role.

### ZeruxServerConfig

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `port` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `devPort` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `allowedDomains` | `string \| string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `allowedDevDomain` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |

### ZeruxDevtoolsConfig

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `modules` | `Array<string \| ZeruxDevtoolsModuleConfig>` | No | Passed using this declared shape; omission is allowed only when marked optional. |

### ZeruxDevtoolsModuleConfig

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `package` | `string` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `enabled` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `options` | `Record<string, unknown>` | No | Passed using this declared shape; omission is allowed only when marked optional. |


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/services.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/services.ts)
