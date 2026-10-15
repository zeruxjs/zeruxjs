# Zeyro — test runner and assertion toolkit

Zeyro is a dependency-light test library for ZeruxJS, ZyroJS and ordinary JavaScript/TypeScript packages. It is **not** the ZyroJS UI runtime. The new API is modular, and existing `describe`, `test`, `expect` and `runTests` entry points remain available.

## Writing tests

```ts
import { describe, test, expect, beforeEach, runTests, fn } from 'zeyro';

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
node dist/bin/cli.js --config zeyro.config.json --reporter json
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

The CLI has zero mandatory browser/test-runner dependencies. It imports runnable JavaScript test files; TypeScript test files must be transpiled or run through a separately configured TypeScript loader. JSON and TAP output are supported. Modules exported by `zeyro/jsdom` and `zeyro/playwright` are **optional adapters**; the environment packages must be separately installed if those features are used. Vitest-shaped helpers do not replace Vitest's full mocking engine.

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
