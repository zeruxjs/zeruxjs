---
{
  "title": "Test runner and assertions",
  "description": "Set up ztrial with explicit lifecycle, typed public APIs and deployment boundaries.",
  "section": "Packages",
  "order": 210,
  "package": "ztrial",
  "sources": [
    "packages/ztrial/README.md",
    "packages/ztrial/package.json"
  ],
  "related": [
    "packages",
    "typescript",
    "configuration-reference"
  ]
}
---

## Installation and integration path

```sh
npm install ztrial@0.0.2
```

This package has its own public API. Installing it does not create an automatic runtime service key in `zerux.config.js`. Use the framework integration described below or initialize it in the tool/application that owns its lifetime.

## Worked TypeScript setup

```ts
import { createRunner } from 'ztrial';
const runner = createRunner();
// Use the runner's declared registration/result APIs for an isolated suite.
type Runner = ReturnType<typeof createRunner>;
```

JavaScript can use the same runtime APIs without type-only statements. Enable JSDoc checking if editor validation is desired; a transpilation step alone does not typecheck the input.

## Usage and configuration

Use an independent runner for isolated tool/workspace ownership, or the exported test/describe registry for a single test process. Configure timeout, retry, filtering and only/skip policy deliberately. The CLI imports runnable JavaScript test files; TypeScript needs a separate transpilation or loader setup.

The package provides assertion/spying helpers and optional environment adapters. A Vitest-shaped adapter is not Vitest's full mocking engine; jsdom and Playwright adapters need their corresponding optional environments installed. Match an adapter to the code under test instead of assuming every API is present in the zero-dependency core.

## Public types

```ts
import { createRunner } from 'ztrial';
type Inputs = Parameters<typeof createRunner>;
type Result = Awaited<ReturnType<typeof createRunner>>;
```

Use installed public declarations and validate untrusted runtime values separately. Avoid deep source imports; the manifest reference below records the actual exported entry points for this version. Generic helpers may preserve a more useful concrete type at the call site than a broad ReturnType alias.

## Failures, ownership and production use

A timeout stops waiting but cannot forcibly cancel an arbitrary promise or roll back external side effects. Tests should close their own servers, timers, watchers and database connections. Retries can repeat those side effects, so use isolated fixtures and idempotent cleanup. Disallow accidentally committed only tests in CI, preserve failing exit status and distinguish skipped coverage from passing assertions.

## Verify the integration

Run the real owning application/tool with a normal input and a failure input. Inspect exit status or typed results, then verify cleanup/restart and the installed production entry point. A successful docs build does not exercise child processes, browser APIs, sockets or filesystem permissions on every supported operating system.

## Option reference

### RunOptions

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `timeoutMs` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `retries` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `throwOnFailure` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `match` | `string \| RegExp` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `bail` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `forbidOnly` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `onResult` | `(result: TestResult) => void` | No | Application-supplied callback or adapter; see the setup and lifecycle discussion. |

### ZtrialConfig

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `root` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `files` | `string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `reporter` | `'pretty'\|'json'\|'tap'` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `bail` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `allowOnly` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
