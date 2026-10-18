# File and routing conventions

Predict URL mapping, method selection and module discovery from source files.


## Route files

| File | Inferred route |
| --- | --- |
| app/page.ts | / |
| app/about/page.ts | /about |
| app/api/health/route.ts | /api/health |
| app/blog/[slug]/page.ts | /blog/:slug |
| app/files/[...path]/route.ts | Catch-all parameter below /files |

index, page and route path segments are removed during inference. Dynamic bracket segments become named params. Static segments sort ahead of competing dynamic segments. Query strings do not define a separate route; inspect context.query.

## Reserved names

layout, loading, template and error are reserved filenames. They do not automatically create component-layout composition, loading boundaries or React error components. A generic Markdown/MDX document is not a route just because it is under app.

## Method selection

Export named HTTP methods for method-specific behavior, or a default handler for generic behavior. Explicit method handlers take precedence over a default module handler. A route module can export routePath or path to replace its inferred pattern. Keep patterns stable and avoid overlaps with reserved service paths.

## Controllers

A module can use a controller string to resolve a discovered controller export. Controller and composable registries include relative keys and basename shortcuts. Prefer distinct basenames and explicit keys where collisions are possible. These are application service references, not an automatic RPC mechanism.

## Plugins and the entry module

Plugins expose default/register/plugin registration functions. The optional root entry module can expose default/register/setup/boot. They receive the plugin API while preparing the generation. Use configured directories and entryPoint to make discovery explicit; do not rely on a file outside build sources being copied automatically.

## Public files

Files in configured public directories become direct URL assets. They bypass ordinary application handler middleware, so store only material intentionally public. File hosting does not run content validation or provide a private download policy.

## TypeScript and module format

A route may use TypeScript source with a typed ZeruxRequestContext, but a supported filename/export is still required for discovery. Adding a file to tsconfig does not register a route. ESM relative imports should describe the emitted module path, and runtime/build loaders must agree on how the module is executed.

Prefer explicit GET/POST exports for method-specific APIs and the documented default handler for a general page. A reserved filename is a discovery rule, not proof that JSX/MDX, suspense or component layout composition exists. Test the output of the actual application compiler after moving or renaming a module.

## Exposure and refactoring checks

Keep configuration, private storage and backups outside public roots. Controller/composable modules are reusable server code, not automatically HTTP endpoints. Avoid duplicate basenames where discovery supports shorthand registry keys; use clear folder/key ownership.

When refactoring, check route inference, explicit routePath/path overrides, dynamic parameter names, imported modules and source-to-build paths. Then test a valid request, wrong method and missing path against the production handler. TypeScript can catch a broken relative import but cannot prove the intended public URL still resolves.


## Implementation sources

- [packages/zeruxjs/src/bootstrap/runtime.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/runtime.ts)
- [packages/zeruxjs/src/bootstrap/config.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/config.ts)
