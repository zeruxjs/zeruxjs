import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as v from '@zeruxjs/validator';
import { createTsConfig, checkTypes } from '@zeruxjs/typescript';

/** Yield briefly to exercise bounded cooperative scheduling in local fixtures.
 * @param {number} ms - Requested timer delay in milliseconds.
 * @returns {Promise<void>} Resolves after the fixture timer fires; no durable work is created. */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('functional transforms, nested paths/codes, unions and object policies', () => {
  /** Explicit string-to-length transform fixture; validates distinct input/output types. */
  const name = v.pipe(
    v.string(),
    v.trim(),
    v.transform((value) => value.length)
  );
  assert.equal(v.parse(name, ' Ada '), 3);
  /** Nested array/object schema exercising original private issue paths and codes. */
  const nested = v.object({ rows: v.array(v.object({ name: v.string() })) });
  /** Fixture parse/type-check result; assertions inspect its explicit success or diagnostic state. */
  const result = v.safeParse(nested, { rows: [{ name: 3 }] });
  assert.equal(result.success, false);
  assert.deepEqual(
    result.issues[0].path.map((item) => item.key),
    ['rows', 0, 'name']
  );
  assert.equal(result.issues[0].code, 'schema.string');
  /** Ordered object branches used to verify successful selection and nested failure reporting. */
  const union = v.union([
    v.object({ value: v.string() }),
    v.object({ value: v.number() }),
  ]);
  assert.deepEqual(v.parse(union, { value: 2 }), { value: 2 });
  /** Invalid Boolean branch input used to verify structured union issues. */
  const denied = v.safeParse(union, { value: false });
  assert.equal(denied.success, false);
  assert.equal(denied.issues[0].code, 'schema.union');
  assert.equal(denied.issues[0].issues[0].path[0].key, 'value');
  assert.deepEqual(
    v.parse(v.object({ name: v.string() }), { name: 'A', extra: 1 }),
    { name: 'A' }
  );
  assert.deepEqual(
    v.parse(v.looseObject({ name: v.string() }), { name: 'A', extra: 1 }),
    { name: 'A', extra: 1 }
  );
  assert.equal(
    v.safeParse(v.strictObject({ name: v.string() }), { name: 'A', extra: 1 })
      .success,
    false
  );
  assert.equal(
    v.safeParse(
      v.object({ name: v.string() }),
      Object.create({ name: 'inherited' })
    ).success,
    false
  );
  assert.equal(v.safeParse(v.object({}), []).success, false);
  assert.throws(
    () => v.parse(v.object(JSON.parse('{"__proto__":{}}')), {}),
    /Unsafe/
  );
  /** Reserved-key input result used to prove issue formatting never mutates object prototypes. */
  const unsafe = v.safeParse(v.strictObject({}), JSON.parse('{"__proto__":1}'));
  assert.doesNotThrow(() => v.formatIssues(unsafe.issues));
  assert.equal({}.polluted, undefined);
});

test('default precedence and identity are deterministic', async () => {
  /** Local callback trace proving default/transform/refinement evaluation order. */
  const order = [];
  /** Explicit fixture schema; callbacks and counters belong only to this test. */
  const schema = v.object({
    value: v.optional(
      v.pipe(
        v.string(),
        v.transform((value) => {
          order.push('transform');
          return value.length;
        }),
        v.check((value) => {
          order.push('check');
          return value > 0;
        })
      ),
      () => {
        order.push('default');
        return 'Ada';
      }
    ),
  });
  assert.deepEqual(v.parse(schema, {}), { value: 3 });
  assert.deepEqual(order, ['default', 'transform', 'check']);
  assert.equal(v.parse(v.nullable(v.string()), null), null);
  assert.equal(v.safeParse(v.optional(v.string()), null).success, false);
  assert.deepEqual(
    v.parse(v.object({ value: v.optional(v.string()) }), {}),
    {}
  );
  assert.deepEqual(
    v.parse(v.object({ value: v.optional(v.string()) }), { value: undefined }),
    { value: undefined }
  );
  let calls = 0;
  v.parse(
    v.object({
      value: v.optional(v.string(), () => {
        calls++;
        return undefined;
      }),
    }),
    {}
  );
  assert.equal(calls, 1);
  /** Borrowed nested fixture object whose identity must survive permissive child validation. */
  const child = { shared: 1 };
  /** Synthetic candidate object; assertions distinguish outer copies from borrowed nested values. */
  const input = { child };
  /** Parsed synthetic output used to verify transformation, identity or concurrency results. */
  const output = v.parse(v.object({ child: v.unknown() }), input);
  assert.notEqual(output, input);
  assert.equal(output.child, child);
  /** Explicit asynchronous fixture schema; no async behavior is silently inferred from strings. */
  const asyncSchema = v.objectAsync({
    value: v.optionalAsync(v.string(), async () => 'Ada'),
  });
  assert.deepEqual(await v.parseAsync(asyncSchema, {}), { value: 'Ada' });
});

test('hard budgets bound deep/cyclic input, schema recursion, work, collections and issues', () => {
  let input = {};
  for (let i = 0; i < 80; i++) {
    input = { child: input };
  }
  assert.throws(
    () => v.safeParse(v.unknown(), input),
    (error) =>
      error instanceof v.ValidationLimitError && error.code === 'max_depth'
  );
  /** Deliberate cyclic synthetic graph used to verify bounded input rejection. */
  const cycle = {};
  cycle.self = cycle;
  assert.throws(
    () => v.parse(v.unknown(), cycle),
    (error) => error.code === 'cyclic_input'
  );
  /** Synthetic accessor that must remain uninvoked during root input admission. */
  const getter = Object.defineProperty({}, 'private', {
    enumerable: true,
    get() {
      throw new Error('must not run');
    },
  });
  assert.throws(
    () => v.parse(v.unknown(), getter),
    (error) => error.code === 'accessor_input'
  );
  assert.throws(
    () => v.parse(v.array(v.string()), ['a', 'b'], { maxCollectionSize: 1 }),
    (error) => error.code === 'max_collection_size'
  );
  assert.throws(
    () => v.parse(v.unknown(), [1, 2], { maxNodes: 2 }),
    (error) => error.code === 'max_nodes'
  );
  /** Deliberately self-referential schema used to verify recursion limits. */
  const recursive = v.lazy(() => recursive);
  assert.throws(
    () => v.parse(recursive, 1),
    (error) => error.code === 'max_depth'
  );
  assert.throws(
    () => v.safeParse(v.array(v.string()), [1, 2], { maxIssues: 1 }),
    (error) => error.code === 'max_issues'
  );
  /** Early-abort result proving only the declared issue budget is consumed. */
  const first = v.safeParse(v.array(v.string()), [1, 2], {
    abortEarly: true,
    maxIssues: 1,
  });
  assert.equal(first.issues.length, 1);
  // Reject each invalid root budget before parsing a valid primitive.
  for (const maxDepth of [0, Infinity, 129, '3']) {
    assert.throws(() => v.parse(v.string(), 'a', { maxDepth }), /maxDepth/);
  }
});

test('sync parses never invoke async schema/refinement callbacks', () => {
  let calls = 0;
  /** Async callback fixture used to prove synchronous parses reject before invoking it. */
  const action = v.checkAsync(async () => {
    calls++;
    return true;
  });
  assert.throws(
    () => v.parse(v.pipeAsync(v.string(), action), 'a'),
    v.AsyncValidationError
  );
  assert.throws(
    () =>
      v.safeParse(v.object({ x: v.pipeAsync(v.string(), action) }), { x: 'a' }),
    v.AsyncValidationError
  );
  assert.throws(
    () =>
      v.parse(
        v.pipe(
          v.string(),
          v.check(async () => {
            calls++;
            return true;
          })
        ),
        'a'
      ),
    v.AsyncValidationError
  );
  assert.equal(calls, 0);
  assert.throws(
    () =>
      v.parse(
        v.optional(v.string(), async () => {
          calls++;
          return 'a';
        }),
        undefined
      ),
    v.AsyncValidationError
  );
  assert.throws(
    () =>
      v.parse(
        v.pipe(
          v.string(),
          v.rawCheck(async () => {
            calls++;
          })
        ),
        'a'
      ),
    v.AsyncValidationError
  );
  assert.equal(calls, 0);
  assert.throws(
    () =>
      v.parse(
        v.pipe(
          v.string(),
          v.check(() => Promise.reject(new Error('misuse')))
        ),
        'a'
      ),
    v.AsyncValidationError
  );
});

test('async refinement concurrency is bounded across nested branches', async () => {
  let active = 0,
    peak = 0;
  /** Cooperative async refinement whose counters track actual active execution. */
  const item = v.pipeAsync(
    v.number(),
    v.checkAsync(async (value, { signal }) => {
      assert.ok(signal instanceof AbortSignal);
      active++;
      peak = Math.max(peak, active);
      try {
        await delay(2);
        return value >= 0;
      } finally {
        active--;
      }
    })
  );
  /** Explicit fixture schema; callbacks and counters belong only to this test. */
  const schema = v.arrayAsync(v.arrayAsync(item));
  /** Parsed synthetic output used to verify transformation, identity or concurrency results. */
  const output = await v.parseAsync(
    schema,
    [
      [1, 2, 3],
      [4, 5, 6],
    ],
    { maxConcurrency: 2 }
  );
  assert.deepEqual(output, [
    [1, 2, 3],
    [4, 5, 6],
  ]);
  assert.equal(peak, 2);
  assert.equal(active, 0);
  peak = 0;
  await v.parseAsync(
    v.pipeAsync(
      v.array(v.number()),
      v.checkItemsAsync(async (_value, _index, _array, { signal }) => {
        assert.ok(signal);
        active++;
        peak = Math.max(peak, active);
        try {
          await delay(1);
          return true;
        } finally {
          active--;
        }
      })
    ),
    [1, 2, 3, 4],
    { maxConcurrency: 2 }
  );
  assert.equal(peak, 2);
  assert.equal(active, 0);
});

test('cancellation drains cooperative validators and removes the root listener', async () => {
  /** Test-owned cancellation signal; the fixture explicitly aborts pending cooperative work. */
  const controller = new AbortController();
  let adds = 0,
    removes = 0,
    active = 0,
    started = 0;
  /** Bound native signal listener registration used to count root listener ownership. */
  const add = controller.signal.addEventListener.bind(controller.signal);
  /** Bound native signal listener removal used to verify balanced root cleanup. */
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (...args) => {
    adds++;
    return add(...args);
  };
  controller.signal.removeEventListener = (...args) => {
    removes++;
    return remove(...args);
  };
  /** Cooperative async refinement whose counters track actual active execution. */
  const item = v.pipeAsync(
    v.number(),
    v.checkAsync(async (_value, { signal }) => {
      started++;
      active++;
      try {
        await new Promise((resolve) =>
          signal.addEventListener('abort', resolve, { once: true })
        );
        return true;
      } finally {
        active--;
      }
    })
  );
  /** Started parse whose rejection is awaited before asserting actual callback drain. */
  const pending = v.safeParseAsync(v.arrayAsync(item), [1, 2, 3, 4], {
    signal: controller.signal,
    maxConcurrency: 2,
  });
  /** Fixture abort timer; its finally block clears the handle after the rejection settles. */
  const timer = setTimeout(() => controller.abort('cancelled by caller'), 5);
  try {
    await assert.rejects(pending, (error) => error.name === 'AbortError');
  } finally {
    clearTimeout(timer);
  }
  assert.equal(active, 0);
  assert.equal(started, 2);
  assert.equal(adds, removes);
  let calls = 0;
  await assert.rejects(
    v.parseAsync(
      v.customAsync(async () => {
        calls++;
        return true;
      }),
      1,
      { signal: controller.signal }
    ),
    { name: 'AbortError' }
  );
  assert.equal(calls, 0);
});

test('dependency failures propagate and abort other owned validators', async () => {
  /** Exact private dependency/hook failure object; tests verify propagation without serialization. */
  const failure = new Error('dependency unavailable');
  let active = 0;
  /** Explicit fixture schema; callbacks and counters belong only to this test. */
  const schema = v.arrayAsync(
    v.pipeAsync(
      v.number(),
      v.checkAsync(async (value, { signal }) => {
        if (value === 0) {
          await delay(2);
          throw failure;
        }
        active++;
        try {
          await new Promise((resolve) =>
            signal.addEventListener('abort', resolve, { once: true })
          );
          return true;
        } finally {
          active--;
        }
      })
    )
  );
  await assert.rejects(
    v.parseAsync(schema, [0, 1, 2], { maxConcurrency: 2 }),
    (error) => error === failure
  );
  assert.equal(active, 0);
});

test('hooks are parse-local, private-value-free and exceptions are explicit', async () => {
  /** Local redacted hook snapshots; assertions reject submitted values and private labels. */
  const events = [];
  v.parse(v.string(), 'private-value', {
    onSuccess: (event) => events.push(event),
  });
  v.safeParse(v.number(), 'private-value', {
    onError: (event) => events.push(event),
  });
  assert.equal(events.length, 2);
  assert.doesNotMatch(JSON.stringify(events), /private-value|input|message/);
  assert.equal(events[1].issues[0].code, 'schema.number');
  v.safeParse(
    v.record(v.string(), v.number()),
    { 'private-value': 'private-value' },
    { onError: (event) => events.push(event) }
  );
  assert.doesNotMatch(JSON.stringify(events), /private-value/);
  /** Exact private dependency/hook failure object; tests verify propagation without serialization. */
  const failure = new Error('hook failed');
  assert.throws(
    () =>
      v.parse(v.string(), 'a', {
        onSuccess() {
          throw failure;
        },
      }),
    (error) => error instanceof v.ValidationHookError && error.cause === failure
  );
  await assert.rejects(
    v.safeParseAsync(v.number(), 'a', {
      onError() {
        throw failure;
      },
    }),
    v.ValidationHookError
  );
  assert.throws(
    () => v.parse(v.string(), 'a', { onSuccess: async () => {} }),
    v.ValidationHookError
  );
  v.setGlobalConfig({
    onSuccess: () => {
      throw new Error('must not become global');
    },
  });
  try {
    assert.equal(v.parse(v.string(), 'a'), 'a');
  } finally {
    v.deleteGlobalConfig();
  }
});

test('default caching stays compatible while explicit parse controls bypass it', async () => {
  let calls = 0;
  /** Explicit fixture schema; callbacks and counters belong only to this test. */
  const schema = v.cache(
    v.pipe(
      v.string(),
      v.transform((value) => {
        calls++;
        return value.length;
      })
    )
  );
  assert.equal(v.parse(schema, 'abc'), 3);
  assert.equal(v.parse(schema, 'abc'), 3);
  assert.equal(calls, 1);
  assert.equal(v.parse(schema, 'abc', { maxNodes: 100 }), 3);
  assert.equal(calls, 2);
  /** Cached failing schema used to prove issue budget charging on repeated cached results. */
  const invalid = v.cache(v.string());
  v.safeParse(invalid, 1);
  assert.throws(
    () => v.safeParse(v.array(invalid), Array(101).fill(1)),
    (error) => error.code === 'max_issues'
  );
  /** Explicit asynchronous fixture schema; no async behavior is silently inferred from strings. */
  const asyncSchema = v.cacheAsync(
    v.pipeAsync(
      v.string(),
      v.checkAsync(async () => true)
    )
  );
  assert.equal(await v.parseAsync(asyncSchema, 'a'), 'a');
});

test('HTTP maps budget failures and never serializes submitted values', async (t) => {
  /** Create a synthetic request for HTTP budget and private-value checks.
   * @param {BodyInit} body - Exact JSON fixture body.
   * @returns {Request} In-memory request with no listening server or network fetch. */
  const make = (body) =>
    new Request('https://example.test/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  /** Test-owned private-error handler; teardown always drains its adapter. */
  const handler = v.validatedJsonHandler(v.number(), () => ({}));
  t.after(() => handler.close());
  /** Synthetic HTTP result; assertions inspect status and client-safe response text. */
  const response = await handler(make('"private-value"'));
  assert.equal(response.status, 422);
  assert.doesNotMatch(await response.text(), /private-value/);
  /** Test-owned unknown-schema handler exercising root collection limits; teardown closes it. */
  const bounded = v.validatedJsonHandler(v.unknown(), () => ({}));
  t.after(() => bounded.close());
  assert.equal(
    (await bounded(make(JSON.stringify(Array(1001).fill(1))))).status,
    413
  );
});

test(
  'installed declarations infer functional transforms, objects, arrays and unions',
  { timeout: 60000 },
  () => {
    /** Owned temporary archive consumer directory, removed recursively in the fixture finally block. */
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'zerux-validator-consumer-')
    );
    /** Write controlled declaration-consumer files under the owned temporary fixture root.
     * @param {string} file - Fixture-relative destination authored by this test.
     * @param {string} text - Exact fixture source/configuration bytes.
     * @returns {void} Creates parent directories and writes the local fixture without executing its source. */
    const write = (file, text) => {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), text);
    };
    try {
      /** Run explicit npm archive/offline-install operations only inside the owned temporary consumer.
       * @param {string[]} args - Authored npm subcommand arguments passed without shell interpolation.
       * @returns {string} Captured command output; timeout/failure propagates and outer finally removes the fixture. */
      const npm = (args) =>
        execFileSync('npm', [...args, '--cache', path.join(root, 'cache')], {
          cwd: root,
          encoding: 'utf8',
          timeout: 30000,
        });
      /** Local npm archive metadata; the consumer installs this package offline without source-path aliases. */
      const packed = Object.values(
        JSON.parse(
          npm([
            'pack',
            path.resolve(import.meta.dirname, '..'),
            '--ignore-scripts',
            '--json',
            '--pack-destination',
            root,
          ])
        )
      )[0];
      write(
        'package.json',
        JSON.stringify({
          name: 'validator-consumer',
          private: true,
          type: 'module',
          dependencies: {
            '@zeruxjs/validator': `file:${path.join(root, packed.filename)}`,
          },
        })
      );
      npm([
        'install',
        '--offline',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
      ]);
      write(
        'src/index.ts',
        `import { string, number, object, array, union, optional, pipe, transform, parse, checkAsync, pipeAsync, parseAsync, type InferInput, type InferOutput } from '@zeruxjs/validator';
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
`
      );
      createTsConfig(root, { preset: 'browser-library' });
      /** Fixture parse/type-check result; assertions inspect its explicit success or diagnostic state. */
      const result = checkTypes({
        cwd: root,
        files: [],
        checkDependencies: true,
      });
      assert.equal(
        result.ok,
        true,
        result.diagnostics
          .map((issue) => JSON.stringify(issue.messageText))
          .join('\n')
      );
      assert.ok(
        !fs.existsSync(path.join(root, 'node_modules/@zeruxjs/validator/src'))
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
);

test('multipleOf preserves native number and bigint remainders without coercion', () => {
  assert.equal(v.parse(v.pipe(v.number(), v.multipleOf(2)), -0), -0);
  assert.equal(v.parse(v.pipe(v.bigint(), v.multipleOf(2n)), 4n), 4n);
  assert.equal(
    v.safeParse(v.pipe(v.number(), v.multipleOf(2)), 3).success,
    false
  );
  assert.equal(
    v.safeParse(v.pipe(v.bigint(), v.multipleOf(2n)), 3n).success,
    false
  );
  assert.equal(
    v.safeParse(v.pipe(v.number(), v.multipleOf(0.1)), 0.3).success,
    false
  );
  assert.throws(
    () => v.parse(v.pipe(v.number(), v.multipleOf(2n)), 4),
    TypeError
  );
  assert.throws(
    () => v.parse(v.pipe(v.bigint(), v.multipleOf(0n)), 4n),
    RangeError
  );
  assert.equal(
    v.safeParse(v.pipe(v.number(), v.multipleOf(0)), 4).success,
    false
  );
  let reads = 0;
  /** Borrowed action with a trusted requirement getter, used to verify arithmetic is evaluated only once. */
  const action = v.multipleOf(2n);
  Object.defineProperty(action, 'requirement', {
    get() {
      reads++;
      return 2n;
    },
  });
  assert.equal(v.parse(v.pipe(v.bigint(), action), 4n), 4n);
  assert.equal(reads, 1);
});
