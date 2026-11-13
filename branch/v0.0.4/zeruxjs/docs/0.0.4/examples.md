# Examples

Public-import recipes with explicit dependencies and honest verification.


## Choose an application

| Recipe                                                     | Implemented output                                        | Required host work                                              |
| ---------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| [First notes API](/branch/v0.0.4/zeruxjs/docs/0.0.4/tutorial.md)                             | File routes and a bounded process-local teaching store    | Real storage/tenant auth before private use                     |
| [ZyroJS + SQLite + BullMQ](/branch/v0.0.4/zeruxjs/docs/0.0.4/example-renderer-data-queue.md) | Public SSR page, synthetic data and explicit snapshot job | Isolated Redis and reviewed local database                      |
| [Zyro generator](/branch/v0.0.4/zeruxjs/docs/0.0.4/reference-create-zyro-app.md)             | JS/TS client, static, SSR or V1 whole-root hydration      | Mode-specific build/hosting prerequisites                       |
| [Zerux generator](/branch/v0.0.4/zeruxjs/docs/0.0.4/reference-create-zerux-js.md)            | JS/TS SSR using explicitly selected renderer              | Node/runtime deployment                                         |
| [Zenix generator](/branch/v0.0.4/zeruxjs/docs/0.0.4/reference-create-zenix-js.md)            | SQLite CMS integration scaffold                           | Host persistent auth, CSRF, setup secret and explicit migration |
| [Private file API](/branch/v0.0.4/zeruxjs/docs/0.0.4/private-file-api.md)                    | Explicitly authorized file access                         | Verified host principals/storage                                |

## Copy contracts, not private source

Use public export paths. A callback such as `authorize` or `resolvePrincipal` must be implemented by the host; its name is not a bundled service. Examples never provision accounts, install remote infrastructure or certify arbitrary deployments. Queue jobs carry references, not private record bodies.


## Implementation sources

- [packages/create/create-zyro-app/src/templates.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/create/create-zyro-app/src/templates.ts)
- [packages/create/create-zerux-app/src/templates.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/create/create-zerux-app/src/templates.ts)
- [packages/create/create-zenix-app/src/templates.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/create/create-zenix-app/src/templates.ts)
