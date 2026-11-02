import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as v from '@zeruxjs/validator';
import { createTsConfig, checkTypes } from '@zeruxjs/typescript';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('functional transforms, nested paths/codes, unions and object policies', () => {
  const name = v.pipe(v.string(), v.trim(), v.transform(value => value.length));
  assert.equal(v.parse(name, ' Ada '), 3);
  const nested = v.object({ rows: v.array(v.object({ name: v.string() })) });
  const result = v.safeParse(nested, { rows: [{ name: 3 }] });
  assert.equal(result.success, false);
  assert.deepEqual(result.issues[0].path.map(item => item.key), ['rows', 0, 'name']);
  assert.equal(result.issues[0].code, 'schema.string');
  const union = v.union([v.object({ value: v.string() }), v.object({ value: v.number() })]);
  assert.deepEqual(v.parse(union, { value: 2 }), { value: 2 });
  const denied = v.safeParse(union, { value: false });
  assert.equal(denied.success, false);
  assert.equal(denied.issues[0].code, 'schema.union');
  assert.equal(denied.issues[0].issues[0].path[0].key, 'value');
  assert.deepEqual(v.parse(v.object({ name: v.string() }), { name: 'A', extra: 1 }), { name: 'A' });
  assert.deepEqual(v.parse(v.looseObject({ name: v.string() }), { name: 'A', extra: 1 }), { name: 'A', extra: 1 });
  assert.equal(v.safeParse(v.strictObject({ name: v.string() }), { name: 'A', extra: 1 }).success, false);
  assert.equal(v.safeParse(v.object({ name: v.string() }), Object.create({ name: 'inherited' })).success, false);
  assert.equal(v.safeParse(v.object({}), []).success, false);
  assert.throws(() => v.parse(v.object(JSON.parse('{"__proto__":{}}')), {}), /Unsafe/);
  const unsafe = v.safeParse(v.strictObject({}), JSON.parse('{"__proto__":1}'));
  assert.doesNotThrow(() => v.formatIssues(unsafe.issues));
  assert.equal({}.polluted, undefined);
});

test('default precedence and identity are deterministic', async () => {
  const order = [];
  const schema = v.object({ value: v.optional(v.pipe(v.string(), v.transform(value => { order.push('transform'); return value.length; }), v.check(value => { order.push('check'); return value > 0; })), () => { order.push('default'); return 'Ada'; }) });
  assert.deepEqual(v.parse(schema, {}), { value: 3 });
  assert.deepEqual(order, ['default', 'transform', 'check']);
  assert.equal(v.parse(v.nullable(v.string()), null), null);
  assert.equal(v.safeParse(v.optional(v.string()), null).success, false);
  assert.deepEqual(v.parse(v.object({ value: v.optional(v.string()) }), {}), {});
  assert.deepEqual(v.parse(v.object({ value: v.optional(v.string()) }), { value: undefined }), { value: undefined });
  let calls = 0;
  v.parse(v.object({ value: v.optional(v.string(), () => { calls++; return undefined; }) }), {});
  assert.equal(calls, 1);
  const child = { shared: 1 }; const input = { child };
  const output = v.parse(v.object({ child: v.unknown() }), input);
  assert.notEqual(output, input); assert.equal(output.child, child);
  const asyncSchema = v.objectAsync({ value: v.optionalAsync(v.string(), async () => 'Ada') });
  assert.deepEqual(await v.parseAsync(asyncSchema, {}), { value: 'Ada' });
});

test('hard budgets bound deep/cyclic input, schema recursion, work, collections and issues', () => {
  let input = {}; for (let i = 0; i < 80; i++) input = { child: input };
  assert.throws(() => v.safeParse(v.unknown(), input), error => error instanceof v.ValidationLimitError && error.code === 'max_depth');
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => v.parse(v.unknown(), cycle), error => error.code === 'cyclic_input');
  const getter = Object.defineProperty({}, 'private', { enumerable: true, get() { throw new Error('must not run'); } });
  assert.throws(() => v.parse(v.unknown(), getter), error => error.code === 'accessor_input');
  assert.throws(() => v.parse(v.array(v.string()), ['a', 'b'], { maxCollectionSize: 1 }), error => error.code === 'max_collection_size');
  assert.throws(() => v.parse(v.unknown(), [1, 2], { maxNodes: 2 }), error => error.code === 'max_nodes');
  const recursive = v.lazy(() => recursive);
  assert.throws(() => v.parse(recursive, 1), error => error.code === 'max_depth');
  assert.throws(() => v.safeParse(v.array(v.string()), [1, 2], { maxIssues: 1 }), error => error.code === 'max_issues');
  const first = v.safeParse(v.array(v.string()), [1, 2], { abortEarly: true, maxIssues: 1 });
  assert.equal(first.issues.length, 1);
  for (const maxDepth of [0, Infinity, 129, '3']) assert.throws(() => v.parse(v.string(), 'a', { maxDepth }), /maxDepth/);
});

test('sync parses never invoke async schema/refinement callbacks', () => {
  let calls = 0;
  const action = v.checkAsync(async () => { calls++; return true; });
  assert.throws(() => v.parse(v.pipeAsync(v.string(), action), 'a'), v.AsyncValidationError);
  assert.throws(() => v.safeParse(v.object({ x: v.pipeAsync(v.string(), action) }), { x: 'a' }), v.AsyncValidationError);
  assert.throws(() => v.parse(v.pipe(v.string(), v.check(async () => { calls++; return true; })), 'a'), v.AsyncValidationError);
  assert.equal(calls, 0);
  assert.throws(() => v.parse(v.optional(v.string(), async () => { calls++; return 'a'; }), undefined), v.AsyncValidationError);
  assert.throws(() => v.parse(v.pipe(v.string(), v.rawCheck(async () => { calls++; })), 'a'), v.AsyncValidationError);
  assert.equal(calls, 0);
  assert.throws(() => v.parse(v.pipe(v.string(), v.check(() => Promise.reject(new Error('misuse')))), 'a'), v.AsyncValidationError);
});

test('async refinement concurrency is bounded across nested branches', async () => {
  let active = 0, peak = 0;
  const item = v.pipeAsync(v.number(), v.checkAsync(async (value, { signal }) => {
    assert.ok(signal instanceof AbortSignal); active++; peak = Math.max(peak, active);
    try { await delay(2); return value >= 0; } finally { active--; }
  }));
  const schema = v.arrayAsync(v.arrayAsync(item));
  const output = await v.parseAsync(schema, [[1, 2, 3], [4, 5, 6]], { maxConcurrency: 2 });
  assert.deepEqual(output, [[1, 2, 3], [4, 5, 6]]);
  assert.equal(peak, 2); assert.equal(active, 0);
  peak = 0;
  await v.parseAsync(v.pipeAsync(v.array(v.number()), v.checkItemsAsync(async (_value, _index, _array, { signal }) => {
    assert.ok(signal); active++; peak = Math.max(peak, active);
    try { await delay(1); return true; } finally { active--; }
  })), [1, 2, 3, 4], { maxConcurrency: 2 });
  assert.equal(peak, 2); assert.equal(active, 0);
});

test('cancellation drains cooperative validators and removes the root listener', async () => {
  const controller = new AbortController();
  let adds = 0, removes = 0, active = 0, started = 0;
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (...args) => { adds++; return add(...args); };
  controller.signal.removeEventListener = (...args) => { removes++; return remove(...args); };
  const item = v.pipeAsync(v.number(), v.checkAsync(async (_value, { signal }) => {
    started++; active++;
    try {
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      return true;
    } finally { active--; }
  }));
  const pending = v.safeParseAsync(v.arrayAsync(item), [1, 2, 3, 4], { signal: controller.signal, maxConcurrency: 2 });
  const timer = setTimeout(() => controller.abort('cancelled by caller'), 5);
  try { await assert.rejects(pending, error => error.name === 'AbortError'); }
  finally { clearTimeout(timer); }
  assert.equal(active, 0); assert.equal(started, 2); assert.equal(adds, removes);
  let calls = 0;
  await assert.rejects(v.parseAsync(v.customAsync(async () => { calls++; return true; }), 1, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('dependency failures propagate and abort other owned validators', async () => {
  const failure = new Error('dependency unavailable'); let active = 0;
  const schema = v.arrayAsync(v.pipeAsync(v.number(), v.checkAsync(async (value, { signal }) => {
    if (value === 0) { await delay(2); throw failure; }
    active++;
    try { await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); return true; }
    finally { active--; }
  })));
  await assert.rejects(v.parseAsync(schema, [0, 1, 2], { maxConcurrency: 2 }), error => error === failure);
  assert.equal(active, 0);
});

test('hooks are parse-local, private-value-free and exceptions are explicit', async () => {
  const events = [];
  v.parse(v.string(), 'private-value', { onSuccess: event => events.push(event) });
  v.safeParse(v.number(), 'private-value', { onError: event => events.push(event) });
  assert.equal(events.length, 2); assert.doesNotMatch(JSON.stringify(events), /private-value|input|message/);
  assert.equal(events[1].issues[0].code, 'schema.number');
  v.safeParse(v.record(v.string(), v.number()), { 'private-value': 'private-value' }, { onError: event => events.push(event) });
  assert.doesNotMatch(JSON.stringify(events), /private-value/);
  const failure = new Error('hook failed');
  assert.throws(() => v.parse(v.string(), 'a', { onSuccess() { throw failure; } }), error => error instanceof v.ValidationHookError && error.cause === failure);
  await assert.rejects(v.safeParseAsync(v.number(), 'a', { onError() { throw failure; } }), v.ValidationHookError);
  assert.throws(() => v.parse(v.string(), 'a', { onSuccess: async () => {} }), v.ValidationHookError);
  v.setGlobalConfig({ onSuccess: () => { throw new Error('must not become global'); } });
  try { assert.equal(v.parse(v.string(), 'a'), 'a'); } finally { v.deleteGlobalConfig(); }
});

test('default caching stays compatible while explicit parse controls bypass it', async () => {
  let calls = 0;
  const schema = v.cache(v.pipe(v.string(), v.transform(value => { calls++; return value.length; })));
  assert.equal(v.parse(schema, 'abc'), 3); assert.equal(v.parse(schema, 'abc'), 3); assert.equal(calls, 1);
  assert.equal(v.parse(schema, 'abc', { maxNodes: 100 }), 3); assert.equal(calls, 2);
  const invalid = v.cache(v.string());
  v.safeParse(invalid, 1);
  assert.throws(() => v.safeParse(v.array(invalid), Array(101).fill(1)), error => error.code === 'max_issues');
  const asyncSchema = v.cacheAsync(v.pipeAsync(v.string(), v.checkAsync(async () => true)));
  assert.equal(await v.parseAsync(asyncSchema, 'a'), 'a');
});

test('HTTP maps budget failures and never serializes submitted values', async () => {
  const make = body => new Request('https://example.test/', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  const handler = v.validatedJsonHandler(v.number(), () => ({}));
  const response = await handler(make('"private-value"'));
  assert.equal(response.status, 422); assert.doesNotMatch(await response.text(), /private-value/);
  const bounded = v.validatedJsonHandler(v.unknown(), () => ({}));
  assert.equal((await bounded(make(JSON.stringify(Array(1001).fill(1))))).status, 413);
});

test('installed declarations infer functional transforms, objects, arrays and unions', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-validator-consumer-'));
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  try {
    const npm = args => execFileSync('npm', [...args, '--cache', path.join(root, 'cache')], { cwd: root, encoding: 'utf8', timeout: 30000 });
    const packed = Object.values(JSON.parse(npm(['pack', path.resolve(import.meta.dirname, '..'), '--ignore-scripts', '--json', '--pack-destination', root])))[0];
    write('package.json', JSON.stringify({ name: 'validator-consumer', private: true, type: 'module', dependencies: { '@zeruxjs/validator': `file:${path.join(root, packed.filename)}` } }));
    npm(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund']);
    write('src/index.ts', `import { string, number, object, array, union, optional, pipe, transform, parse, checkAsync, pipeAsync, parseAsync, type InferInput, type InferOutput } from '@zeruxjs/validator';
import { parseJsonRequest, createHttpInputAdapter, type HttpInputAdapter } from '@zeruxjs/validator/http';
import { string as browserString, createFormFeedback } from '@zeruxjs/validator/browser';
import { number as pureNumber } from '@zeruxjs/validator/schemas';
const pureValue: number = parse(pureNumber(), 1); void pureValue;
const adapter: HttpInputAdapter = createHttpInputAdapter({ duplicates: 'reject', bodyTimeoutMs: 1000 });
const browserValue: string = parse(browserString(), 'Ada');
void adapter; void browserValue; void createFormFeedback;
const length = pipe(string(), transform(value => value.length));
const shorthand = string([transform((value: string) => value.length)]);
const schema = object({ name: length, count: optional(number(), 1), values: array(union([string(), number()])) });
type Equal<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2) ? true : false;
type Assert<T extends true> = T;
export type Input = Assert<Equal<InferInput<typeof length>, string>>;
export type Output = Assert<Equal<InferOutput<typeof length>, number>>;
export type Shorthand = Assert<Equal<InferOutput<typeof shorthand>, number>>;
const input: InferInput<typeof schema> = { name: 'Ada', values: ['one', 2] };
const output: InferOutput<typeof schema> = parse(schema, input);
const size: number = output.name;
const count: number = output.count;
// @ts-expect-error transformed input is a string
const wrong: InferInput<typeof length> = 1;
// @ts-expect-error transformed output is a number
const wrongOutput: InferOutput<typeof length> = 'a';
const asyncSchema = pipeAsync(string(), checkAsync(async (value, {signal}) => !signal?.aborted && value.length > 0));
void parseAsync(asyncSchema, 'Ada');
void parseJsonRequest; void size; void count; void wrong; void wrongOutput;
`);
    createTsConfig(root, { preset: 'browser-library' });
    const result = checkTypes({ cwd: root, files: [], checkDependencies: true });
    assert.equal(result.ok, true, result.diagnostics.map(issue => JSON.stringify(issue.messageText)).join('\n'));
    assert.ok(!fs.existsSync(path.join(root, 'node_modules/@zeruxjs/validator/src')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
