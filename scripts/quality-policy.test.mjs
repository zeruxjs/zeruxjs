import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ESLint } from 'eslint';
import { HtmlValidate } from 'html-validate';
import stylelint from 'stylelint';
import * as prettier from 'prettier';
import config from '../prettier.config.mjs';

/** Local value for root. */
const root = new URL('../', import.meta.url);

test('formatter expands compressed source and is stable', async () => {
  /** Local value for source. */
  const source = 'function sum(a,b){const n=a+b;return n;}';
  /** Local value for formatted. */
  const formatted = await prettier.format(source, {
    ...config,
    parser: 'babel',
  });
  assert.match(formatted, /\n {2}const n = a \+ b;\n {2}return n;/);
  assert.equal(
    await prettier.format(formatted, { ...config, parser: 'babel' }),
    formatted
  );
});

test('HTML retains semantic checks and rejects malformed attribute spacing', async () => {
  /** Local value for config. */
  const config = JSON.parse(
    await readFile(new URL('htmlvalidate.config.json', root), 'utf8')
  );
  /** Local value for validator. */
  const validator = new HtmlValidate(config);
  assert.equal(
    (
      await validator.validateString(
        '<!DOCTYPE html><html lang="en"><head><title>Fixture</title></head><body><p>Readable</p></body></html>'
      )
    ).valid,
    true
  );
  /** Local value for invalid. */
  const invalid = await validator.validateString(
    '<div title = "unsafe spacing"></div>'
  );
  assert.ok(
    invalid.results
      .flatMap((result) => result.messages)
      .some((message) => message.ruleId === 'attr-delimiter')
  );
});

test('CSS comment readability preserves standard validation', async () => {
  /** Local value for result. */
  const result = await stylelint.lint({
    code: '/*missing padding*/\na { color: red; }',
    codeFilename: 'fixture.css',
    configFile: new URL('stylelint.config.mjs', root).pathname,
  });
  assert.ok(
    result.results[0].warnings.some(
      (warning) => warning.rule === 'comment-whitespace-inside'
    )
  );
});

test('ESLint retains security checks; reviewed scopes are unique real manifests', async () => {
  /** Local value for eslint. */
  const eslint = new ESLint();
  /** Local value for config. */
  const config = await eslint.calculateConfigForFile(
    'scripts/quality-policy.test.mjs'
  );
  assert.equal(config.rules['no-eval'][0], 2);
  /** Local value for destructured values. */
  const { completed } = JSON.parse(
    await readFile(new URL('quality-scopes.json', root), 'utf8')
  );
  assert.equal(new Set(completed).size, completed.length);
  for (const scope of completed) {
    /** Local value for manifest. */
    const manifest = JSON.parse(
      await readFile(new URL(`${scope}/package.json`, root), 'utf8')
    );
    assert.ok(manifest.name);
    /** Local value for rules. */
    const rules = (
      await eslint.calculateConfigForFile(`${scope}/src/quality-fixture.ts`)
    ).rules;
    assert.equal(rules.curly[0], 2);
  }
});

test('reviewed code rejects undocumented constants and incomplete function contracts', async () => {
  /** Local value for eslint. */
  const eslint = new ESLint();
  /** Local value for file path. */
  const filePath = 'packages/@zeruxjs/typescript/src/quality-fixture.ts';
  /** Local value for destructured values. */
  const [invalid] = await eslint.lintText(
    '/** Echo a value. */\nexport function echo(value: number): number { return value; }\nconst limit = 2;\nvoid limit;',
    { filePath }
  );
  for (const rule of [
    'jsdoc/require-param',
    'jsdoc/require-returns',
    'jsdoc/require-jsdoc',
  ]) {
    assert.ok(
      invalid.messages.some((message) => message.ruleId === rule),
      rule
    );
  }
  /** Local value for destructured values. */
  const [valid] = await eslint.lintText(
    '/** Echo without coercion.\n * @param {number} value - Caller-owned numeric input.\n * @returns {number} The unchanged input.\n */\nexport function echo(value: number): number {\n return value;\n}\n/** Maximum synthetic fixture count. */\nconst limit = 2;\nvoid limit;',
    { filePath }
  );
  assert.equal(valid.errorCount, 0, JSON.stringify(valid.messages));
});

test('reviewed contracts require real parameter/return types and descriptions', async () => {
  /** Local value for eslint. */
  const eslint = new ESLint();
  /** Local value for destructured values. */
  const [result] = await eslint.lintText(
    '/** Return the input.\n * @param value\n * @returns\n */\nexport function identity(value: number): number {\n return value;\n}',
    { filePath: 'packages/@zeruxjs/typescript/src/quality-fixture.ts' }
  );
  for (const rule of [
    'jsdoc/require-param-type',
    'jsdoc/require-param-description',
    'jsdoc/require-returns-type',
    'jsdoc/require-returns-description',
  ]) {
    assert.ok(
      result.messages.some((message) => message.ruleId === rule),
      rule
    );
  }
});

test('reviewed interfaces and constants need meaningful adjacent documentation', async () => {
  /** Local value for eslint. */
  const eslint = new ESLint();
  /** Local value for destructured values. */
  const [result] = await eslint.lintText(
    'export interface Policy { limit: number; }\n/** */\nconst limit = 1;\nvoid limit;',
    { filePath: 'packages/@zeruxjs/typescript/src/quality-fixture.ts' }
  );
  assert.ok(
    result.messages.some((message) => message.ruleId === 'jsdoc/require-jsdoc')
  );
  assert.ok(
    result.messages.some(
      (message) => message.ruleId === 'jsdoc/require-description'
    )
  );
});

test('exported constants attach documentation to their export declaration', async () => {
  /** Local value for eslint. */
  const eslint = new ESLint();
  /** Local value for file path. */
  const filePath = 'packages/@zeruxjs/typescript/src/quality-fixture.ts';
  /** Local value for destructured values. */
  const [valid] = await eslint.lintText(
    '/** Maximum synthetic input count. */\nexport const maximum = 4;',
    { filePath }
  );
  assert.equal(valid.errorCount, 0, JSON.stringify(valid.messages));
  /** Local value for destructured values. */
  const [invalid] = await eslint.lintText('export const maximum = 4;', {
    filePath,
  });
  assert.ok(
    invalid.messages.some((message) => message.ruleId === 'jsdoc/require-jsdoc')
  );
});
