# ZeruxJS — Build your idea. Connect your stack.

From the first route to the services behind it. ZeruxJS brings your Node.js application together, with focused TypeScript tools you can use along the way.

Early development. Open source. Explore the current capabilities in the docs.

[Start building]({{FRAMEWORK_TUTORIAL_URL}}) · [Documentation](/zeruxjs/) · [GitHub](https://github.com/zeruxjs/zeruxjs)

## Your ambition is big. Your stack can stay connected.

- **One request. Connected services.** Routes, configuration, middleware, plugins and application lifecycle management share a common runtime.
- **Your stack. Your building blocks.** Use the framework or focused packages. Choose adapters for databases, cache, files and email around your application's needs.
- **TypeScript, all the way through.** Typed request contexts, configuration and public APIs, with source-linked guides explaining setup and boundaries.

## Start small. Connect as you grow.

1. Define the application in `zerux.config.js`: describe the structure and services it uses.
2. Add file-based routes, middleware and plugins. Connect adapters as your application grows.
3. Compile your application, check its configuration and follow the deployment guide for your environment.

[Understand the runtime]({{FRAMEWORK_ARCHITECTURE_URL}}) · [Explore configuration]({{FRAMEWORK_CONFIG_URL}})

```ts
// app/api/hello/route.ts
export function GET() {
  return { message: "Hello, possibility.", ready: true };
}
```

## One ecosystem. Different ways to build.

- **ZeruxJS — early development.** The application runtime: routes, middleware, lifecycle hooks, workers and connected services. [Explore the framework](/zeruxjs/).
- **ZyroJS — available, evolving.** Standalone reactive primitives, DOM rendering and lifecycle helpers. [Explore the library](https://github.com/zeruxjs/zeruxjs/tree/master/packages/zyrojs).
- **ZenixJS — planned, placeholder.** A future CMS built around the ecosystem. Current packages expose placeholder metadata, not a working CMS. [Follow development](https://github.com/zeruxjs/zeruxjs/tree/master/packages/zenixjs).

## The right tool for the next step.

Explore {{PACKAGE_COUNT}} public packages for data, styling, security, development and more.

{{PACKAGE_LIST}}

## Make room for your next idea.

Follow a working application tutorial. Get to know the runtime. Build something, understand the pieces, and help shape what comes next.

```sh
npm install zeruxjs
```

Follow the [tutorial]({{FRAMEWORK_TUTORIAL_URL}}) for complete setup requirements.
