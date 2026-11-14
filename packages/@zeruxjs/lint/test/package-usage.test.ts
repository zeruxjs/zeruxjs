import test from 'node:test';
import assert from 'node:assert/strict';
import { Linter } from 'eslint';
import {
  createPackageConfig,
  createApplicationConfig,
} from '@zeruxjs/lint/presets';

/** Opt into policy without requiring localization for isolated rule tests. */
const config = createPackageConfig({ environment: 'node', packageUsage: true });
/** Check a statically proven module source or discovered file before reporting diagnostics.
 * @param {string} source - Synthetic text or parser expression inspected without execution.
 * @param {object[]} settings - Explicit fixture configuration overriding the local default.
 * @returns {object[]} Filtered static rule diagnostics for the synthetic fixture; the source is never executed.
 */
const check = (source, settings = config) =>
  new Linter()
    .verify(source, settings, { filename: 'app.ts' })
    .filter((item) => item.ruleId === 'zerux/package-usage');

test('direct runtime SDK imports recommend verified managed public functions', () => {
  // source is synthetic syntax for a positive/negative static-analysis case; never execute it.
  for (const source of [
    "import mail from 'nodemailer';",
    "export * from 'nodemailer/lib/smtp-transport';",
    "require('nodemailer');",
    "import('nodemailer');",
    "import mail = require('nodemailer');",
  ]) {
    /** Recommendation must name the actual public email factory without rewriting the input. */
    const result = check(source);
    assert.equal(result.length, 1, source);
    assert.match(result[0].message, /@zeruxjs\/email: createEmailManager/);
    assert.equal(result[0].severity, 2);
  }
  assert.match(
    check("import { build } from 'esbuild';")[0].message,
    /buildTypescript/
  );
});

test('native watching is targeted; valid primitives, erased types and shadowed require remain valid', () => {
  assert.equal(check("import { watch as observe } from 'node:fs';").length, 1);
  assert.equal(check("import fs from 'node:fs'; fs.watch('.');").length, 1);
  // source is synthetic syntax for a positive/negative static-analysis case; never execute it.
  for (const source of [
    "import { readFile } from 'node:fs/promises';",
    "import fs from 'node:fs'; fs.readFileSync('fixture');",
    "import type { Transporter } from 'nodemailer';",
    "import { type Transporter } from 'nodemailer';",
    "export type { Transporter } from 'nodemailer';",
    "function require(name) {return name;} require('nodemailer');",
    "import fs from 'node:fs'; function f(fs) {fs.watch('.');}",
    "import { createEmailManager } from '@zeruxjs/email';",
    "fetch('/public');",
    'import(dynamicName);',
  ]) {
    assert.deepEqual(check(source), [], source);
  }
});

test('policy selection, explicit native escape hatches and no autofix', async () => {
  assert.deepEqual(check("import 'nodemailer';", createPackageConfig()), []);
  /** Strict consumer preset enables managed package policy by default. */
  const strict = await createApplicationConfig();
  assert.equal(check("import 'nodemailer';", strict).length, 1);
  assert.deepEqual(
    check(
      "import 'nodemailer';",
      await createApplicationConfig({ packageUsage: false })
    ),
    []
  );
  /** Host-owned exact exceptions do not grant subpath or unrelated SDK access. */
  const exceptions = [
    ...config,
    {
      rules: {
        'zerux/package-usage': ['error', { allow: ['nodemailer', 'node:fs'] }],
      },
    },
  ];
  assert.deepEqual(
    check("import 'nodemailer'; import {watch} from 'node:fs';", exceptions),
    []
  );
  assert.equal(
    check("import 'nodemailer/lib/smtp-transport';", exceptions).length,
    1
  );
  assert.throws(
    () => createPackageConfig({ packageUsage: 'yes' }),
    /packageUsage/
  );
  /** A managed rewrite cannot safely preserve arbitrary SDK semantics. */
  const fixed = new Linter().verifyAndFix("import 'nodemailer';", config, {
    filename: 'app.ts',
  });
  assert.equal(fixed.fixed, false);
  assert.equal(fixed.output, "import 'nodemailer';");
});
