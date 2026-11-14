import { createDeprecationRegistry as rootRegistry } from '@zeruxjs/lint';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Linter } from 'eslint';
import {
  createPackageConfig,
  createApplicationConfig,
  createDeprecationRegistry,
  builtInDeprecations,
} from '@zeruxjs/lint/presets';

/** Synthetic third-party migration fact; no fixture module is installed or executed. */
const entry = {
  module: 'fixture-sdk',
  export: 'oldSend',
  since: '2.0',
  reason: 'Old delivery API is retired.',
  replacement: 'send',
  kind: 'runtime',
};
/** Fresh isolated config contains a validated immutable registry snapshot. */
const config = createPackageConfig({
  environment: 'node',
  deprecations: [entry],
});
/** Inspect only the registered deprecation diagnostics from inert fixture syntax.
 * @param {string} source - Synthetic code, never imported or executed.
 * @param {object[]} [settings=config] - Explicit owning flat configuration.
 * @returns {object[]} Deprecation records; no fixes or module discovery occur.
 */
const check = (source, settings = config) =>
  new Linter()
    .verify(source, settings, { filename: 'fixture.ts' })
    .filter((item) => item.ruleId === 'zerux/deprecated-api');

test('registered APIs honor aliases, namespace members, reexports and CommonJS ownership', () => {
  // Each source names the same exported function through a different proven static binding.
  for (const source of [
    "import { oldSend as renamed } from 'fixture-sdk';",
    "export { oldSend as renamed } from 'fixture-sdk';",
    "import * as sdk from 'fixture-sdk'; sdk.oldSend();",
    "import * as sdk from 'fixture-sdk'; sdk['oldSend']();",
    "const sdk = require('fixture-sdk'); sdk.oldSend();",
    "const {oldSend: renamed} = require('fixture-sdk');",
    "require('fixture-sdk').oldSend();",
  ]) {
    /** Only this registered API's public migration text enters diagnostics. */
    const result = check(source);
    assert.equal(result.length, 1, source);
    assert.equal(result[0].severity, 1);
    assert.match(result[0].message, /since 2\.0.*send/);
  }
  // Similar names, unknown members, erased runtime imports and shadowed owners are not deprecation evidence.
  for (const source of [
    "import { send } from 'fixture-sdk';",
    "import {oldSend} from 'unregistered-sdk';",
    "import type {oldSend} from 'fixture-sdk';",
    "function require(value){return value;} require('fixture-sdk').oldSend();",
    "import * as sdk from 'fixture-sdk'; function f(sdk){sdk.oldSend();}",
    "import * as sdk from 'fixture-sdk'; sdk[dynamicName]();",
    "import('fixture-sdk');",
  ]) {
    assert.deepEqual(check(source), [], source);
  }
});

test('source-verified aliases, custom ZeruxJS entries and strict severity remain explicit', async () => {
  assert.ok(
    builtInDeprecations.every(
      (item) => item.kind === 'type' && Object.isFrozen(item)
    )
  );
  assert.equal(
    check("import type {NanoIDIssue} from '@zeruxjs/validator/schemas';")
      .length,
    1
  );
  assert.deepEqual(
    check("import type {NanoIdIssue} from '@zeruxjs/validator/schemas';"),
    []
  );
  assert.deepEqual(
    check(
      "import type {NanoIDIssue} from '@zeruxjs/validator/schemas';",
      createPackageConfig({ includeBuiltInDeprecations: false })
    ),
    []
  );
  /** Hosts can register a verified function in their own package namespace without changing lint source. */
  const custom = createPackageConfig({
    deprecations: [{ ...entry, module: '@zeruxjs/example-plugin' }],
  });
  assert.equal(
    check("import {oldSend} from '@zeruxjs/example-plugin';", custom).length,
    1
  );
  /** Strict policy uses the same registry at error severity; security rules stay unchanged. */
  const strict = await createApplicationConfig({ deprecations: [entry] });
  assert.equal(
    check("import {oldSend} from 'fixture-sdk';", strict)[0].severity,
    2
  );
});

test('registry snapshots reject malformed/duplicate facts without executing getters', () => {
  /** Mutable input belongs to the host; changing it later cannot rewrite an active policy. */
  const mutable = { ...entry };
  /** Frozen config data can be inspected and passed into presets or composed by another package. */
  const snapshot = createDeprecationRegistry([mutable], {
    includeBuiltIns: false,
  });
  mutable.reason = 'changed';
  assert.equal(snapshot[0].reason, entry.reason);
  assert.deepEqual(rootRegistry([entry], { includeBuiltIns: false }), snapshot);
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot[0]));
  assert.throws(() => createDeprecationRegistry([entry, entry]), /duplicate/);
  // Invalid registry facts fail before a plugin or optional extractor is created.
  for (const invalid of [
    { ...entry, module: '../private' },
    { ...entry, module: 'sdk/../private' },
    { ...entry, reason: '' },
    { ...entry, kind: 'anything' },
    { ...entry, callback() {} },
  ]) {
    assert.throws(() => createDeprecationRegistry([invalid]), TypeError);
  }
  /** A throwing accessor proves records are inspected as descriptors before field reads. */
  const accessor = {
    ...entry,
    get reason() {
      throw new Error('must not execute');
    },
  };
  assert.throws(
    () => createDeprecationRegistry([accessor]),
    /known data fields/
  );
  assert.throws(
    () => createDeprecationRegistry(Array.from({ length: 129 }, () => entry)),
    /registry options/
  );
});

test('module-wide declarations and host-managed severity have no custom autofix', () => {
  /** Module-wide retirement is explicit rather than inferred from one deprecated export. */
  const settings = createPackageConfig({
    deprecations: [{ ...entry, export: '*' }],
  });
  assert.equal(check("import('fixture-sdk');", settings).length, 1);
  /** Hosts can disable this migration policy without disabling security/ownership rules. */
  const disabled = [...config, { rules: { 'zerux/deprecated-api': 'off' } }];
  assert.deepEqual(check("import {oldSend} from 'fixture-sdk';", disabled), []);
  /** Renaming an arbitrary deprecated call could change its arguments or side effects. */
  const fixed = new Linter().verifyAndFix(
    "import {oldSend} from 'fixture-sdk';",
    config,
    { filename: 'fixture.ts' }
  );
  assert.equal(fixed.fixed, false);
  assert.equal(fixed.output, "import {oldSend} from 'fixture-sdk';");
});

test('builtins count toward the total registry budget', () => {
  assert.throws(
    () =>
      createDeprecationRegistry(
        Array.from({ length: 123 }, (_, index) => ({
          ...entry,
          export: `old${index}`,
        }))
      ),
    /128 facts/
  );
});
