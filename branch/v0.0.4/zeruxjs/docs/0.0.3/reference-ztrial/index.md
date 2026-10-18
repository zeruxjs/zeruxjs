# Test runner and assertions

Set up ztrial with explicit lifecycle, typed public APIs and deployment boundaries.


## Installation and integration path

```sh
npm install ztrial@0.0.3
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


## Public entry points

Manifest reference for `ztrial@0.0.3`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./jsdom": "./dist/adapters/jsdom/setup.js",
    "./playwright": "./dist/adapters/playwright/setup.js",
    "./vitest": "./dist/adapters/vitest/setup.js"
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {},
  "bin": {
    "ztrial": "./dist/bin/cli.js"
  }
}
```


## Package README

# Ztrial — test runner and assertion toolkit

Ztrial is a dependency-light test library for ZeruxJS, ZyroJS and ordinary JavaScript/TypeScript packages. It is **not** the ZyroJS UI runtime. The new API is modular, and existing `describe`, `test`, `expect` and `runTests` entry points remain available.

## Writing tests

```ts
import { describe, test, expect, beforeEach, runTests, fn } from 'ztrial';

describe('cart', () => {
  beforeEach(() => { /* reset fixture */ });
  test('adds items', () => expect([1, 2]).toHaveLength(2));
  test.each([1, 2, 3])('supports count %#', value => expect(value).toBeGreaterThan(0));
  test.withOptions('network', { timeoutMs: 3000, retries: 1 }, async () => {
    await expect(Promise.resolve('ok')).toResolve();
  });
});

const summary = await runTests({ throwOnFailure: true });
```

Suite-scoped `beforeAll`, `afterAll`, `beforeEach`, and `afterEach` hooks execute deterministically. Supports `test.only`, `test.skip`, `describe.only`, `describe.skip`, timeout/retry limits, fail-fast `bail`, `forbidOnly`, filtering, and callback result reporting. `createRunner()` creates an independent test registry that avoids cross-project global state.

Assertions include `toBe`, circular-safe `toEqual`, `.not`, `toContain`, `toMatch`, `toHaveLength`, `toHaveProperty`, `toThrow`, `toReject` and `toResolve`. `fn`, `spyOn`, and `restoreAllMocks` supply lightweight spies. `waitFor` polls asynchronous conditions with an optional AbortSignal.

## CLI

Build first, then run `.test.js`, `.spec.js`, `.test.mjs`, or `.spec.mjs` files:

```sh
npm run build
node dist/bin/cli.js --reporter pretty
node dist/bin/cli.js --match "cart" --reporter tap
node dist/bin/cli.js --config ztrial.config.json --reporter json
```

Example JSON configuration:

```json
{
  "root": ".",
  "files": ["tests/**/*.test.mjs"],
  "timeoutMs": 5000,
  "retries": 1,
  "bail": false,
  "allowOnly": false,
  "reporter": "pretty"
}
```

The CLI has zero mandatory browser/test-runner dependencies. It imports runnable JavaScript test files; TypeScript test files must be transpiled or run through a separately configured TypeScript loader. JSON and TAP output are supported. Modules exported by `ztrial/jsdom` and `ztrial/playwright` are **optional adapters**; the environment packages must be separately installed if those features are used. Vitest-shaped helpers do not replace Vitest's full mocking engine.

### Important limitations

Timeouts prevent the runner from waiting forever but cannot forcibly cancel an arbitrary test promise. Browser adapters require an installed browser/DOM environment; no native browser or Playwright automation is bundled. This is a focused foundation rather than a fully compatible replacement for Jest, Vitest, or Playwright.

## Verification

```sh
npm run build
node --test test/*.test.mjs
```

## Section 79 test-runner safeguards

- `--config` accepts a size-limited JSON file; a relative `root` in that file
  resolves from the file's directory, not the caller's working directory.
- CLI flags require values and numeric timeouts are bounded to ten minutes.
- Discovery ignores symlink entries, `.git`, `node_modules` and `dist`.
- Zero matching files, zero registered test cases and `--match` selecting no
  runnable test cases now fail with exit code `2` instead of reporting a green run.
- `--bail` executes `afterAll` for suites already started; cleanup hook failures
  remain visible as test failures. Timeouts bound reporting but cannot forcibly
  cancel arbitrary JavaScript async operations.

Verify with `npm run build && node --test test/*.test.mjs`. No browser/runtime
certification is inferred from source-only tests.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Release 0.0.3

Synchronized ecosystem release, including Zuixs CSS-entry support and documentation updates. Existing placeholder packages retain their documented limitations.


## Implementation sources

- [packages/ztrial/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/ztrial/README.md)
- [packages/ztrial/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/ztrial/package.json)
