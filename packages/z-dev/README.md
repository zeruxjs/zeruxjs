> [!WARNING]
> This package is in a very early stage of development and is only published for pre-saving the name from being taken by somebody else. All current versions follow the `0.0.1-alpha.x` pattern.

# z-dev


The internal development toolkit for **Zdev**. `z-dev` provides the foundational infrastructure for developer tools, including the shared dev server, dev-client injection, and the devtools module registry.

## Core Capabilities

- **Shared Dev Server**: Orchestrates a single devtools server that can handle multiple Zdev applications simultaneously.
- **Client Injection**: Automatically injects development scripts and overlays into HTML responses during development mode.
- **Module Registry**: A flexible system to register and manage devtools modules, complete with API and WebSocket handlers.
- **Event Bus**: A robust event broadcaster for hot-updates and real-time communication between the server and the browser.
- **Security**: Integrated with `@zeruxjs/security` to ensure devtools access is authorized and safe.

## Key APIs

### App Registration
```typescript
import { registerSharedDevApp } from 'z-dev';

const devInfo = await registerSharedDevApp({
    appName: 'my-app',
    appPort: 3000,
    rootDir: process.cwd()
});
```

### Client Injection
```typescript
import { injectDevClient } from 'z-dev';

const polyfilledHtml = injectDevClient(originalHtml, {
    routeName: 'my-app',
    devServerUrl: 'http://localhost:4000'
});
```

### Module Definition
```typescript
import { defineDevtoolsModule } from 'z-dev';

export default defineDevtoolsModule({
    name: 'my-module',
    // ... config and handlers
});
```

## Internal Architecture

`z-dev` is designed to be the "brain" behind the Zdev development experience. It manages the lifecycle of the dev server and provides the bridge between the framework's internal services and the developer-facing dashboard.

---

<p align="center">
  Part of the Zdev Monorepo.
</p>


## Request boundaries (Section 7)

The HTTP devtools server enforces a 1 MiB streamed request-body limit via `src/request.ts`, with cleanup on completion, failure, or aborted requests. Local development hostname checks reject crafted authorities. Focused tests: `node --test test/request.test.mjs` after building. Devtools should be restricted to trusted networks; configure firewall and proxy access appropriately.

### Security and live reload diagnostics

The shared development server is loopback-only by default. To listen on a different interface, set `ZDEV_BIND_HOST` **only with trusted access controls**, such as an authenticated reverse proxy. Devtools and its APIs are not an Internet-facing administration service.

State and registry JSON files are private, bounded, atomic and reject symlink destinations. Client HTML injection escapes script-breaking values. Snapshot and bootstrap JSON include a `reload` status object containing the attempt count, generation and last failure message when available.
