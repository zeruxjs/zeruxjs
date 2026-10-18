# Rendering and accessibility

Understand the boundary between server routes and browser features.


## HTML rendering

A server page can return a complete HTML string. Layout files are reserved by discovery, but this does not automatically compose layouts or render MDX. This documentation site uses its own shared server-side template at build time.

## Frontend ecosystem

The monorepo includes React, Vue, ZyroJS and Zuixs packages. Check each package README and exports for current capabilities. Avoid assuming a complete hydration pipeline or framework adapter from its package name.

## Accessible enhancement

zeruxjs/accessibility exports bindAccessibleTabs and prefersReducedMotion. Tabs require buttons with matching aria-controls, panel IDs and aria-labelledby references. Destroy the binding on unmount. DOM globals are accessed inside browser functions, making imports safe on the server.

## Template variables

createVariableRegistry, variables, registerVariable and renderVariables expose configurable variable resolution. Treat escaping as a security boundary and use the correct escape mode for the output context.

## Application styling

Use [Zuixs utility-first styling](/branch/v0.0.4/zeruxjs/docs/0.0.4/styling.md) for theme tokens, responsive utilities and component/Markdown recipes. The documentation site uses this compiler for its complete design.

## Choose the server/browser boundary explicitly

The runtime can return complete HTML and serve browser assets, but a frontend bridge package does not install a component renderer. Keep page/server configuration separate from browser entry points and decide how initial state is serialized. A typed store bridge is useful without claiming automatic React/Vue hydration or a file-based client router.

For React, inject actual hooks and keep selectors stable. For Vue, use actual effect scopes and the injected Vue runtime bindings. For standalone ZyroJS use its DOM/network entry points with explicit unmount/disposal. The observable bridge `@zeruxjs/zyro` has a different API from the standalone renderer.

## TypeScript and public data

A shared state interface can describe public initial data, but it should be an explicit subset of server state. Never serialize whole request contexts, environment objects or manager options into a script. Escape script-embedded JSON for its output context and validate user-controlled values at the server boundary before adding them to state.

Browser TypeScript needs DOM libraries and a browser bundling target. Server code needs Node types and must not evaluate document/window at module import. The [TypeScript chapter](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) explains separate checking/building and the package guides show actual adapter inputs.

## Progressive enhancement and verification

Render meaningful links/forms/content before adding search, copying, sharing or client state. Test the page with JavaScript disabled, keyboard navigation, narrow viewports, dark/system/light themes and reduced motion. A visible toggle is not proof that every menu/dialog/surface changes correctly.

Check SSR with two different users concurrently, then hydrate the matching snapshot on the client if the chosen renderer supports it. Dispose route/component subscriptions when leaving. A local browser screenshot does not certify every assistive technology or all framework adapters; report the environments actually verified.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/types.ts)
