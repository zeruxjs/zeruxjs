> [!WARNING]
> This package is in a very early stage of development and is only published for pre-saving the name from being taken by somebody else. All current versions follow the `0.0.1-alpha.x` pattern.

# zsrv


The core server orchestration engine for **ZeruxJS**. `zsrv` manages the lifecycle of both the application server and the development environment, providing a seamless "zero-config" experience.

## Features

- **Dual Server Management**: Starts and manages your application server alongside a dedicated developer tools server.
- **Hot-Reloading**: Integrated with `zwatch` for intelligent, fast restarts on file changes.
- **Zero-Port Management**: Automatically finds available ports for your services to avoid "Address in Use" errors.
- **Portless Proxies**: Support for local domain aliases (e.g., `my-app.localhost`) for a production-like local development experience.
- **WebSocket Gateway**: Built-in WS server for real-time communication between the framework and devtools.

## Usage

### Starting a Server

```typescript
import { startServer } from 'zsrv';

await startServer({
    app: {
        name: 'my-app',
        func: (req, res) => {
            res.end('Hello from Zerux!');
        }
    },
    dev: {
        port: 4000,
        watchFunc: async (file) => {
            console.log('Reloading due to change in:', file);
        }
    }
});
```

## Integrations

`zsrv` acts as the glue between several core components:
- **`zwatch`**: For monitoring source changes.
- **`z-dev`**: For devtools registration and dashboard management.
- **`ws`**: For the real-time event pipeline.
- **`portless`**: For internal local-domain routing.

## Development Mode

When running in development mode (`details.dev` provided), `zsrv` will:
1. Register the application with the shared dev server.
2. Inject the development client into all HTML responses.
3. Establish a WebSocket connection for hot updates.
4. Set up local domain aliases if supported.

---

<p align="center">
  The engine powering ZeruxJS Applications.
</p>
