import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as ts from 'typescript';
import { buildTypescript } from '@zeruxjs/typescript';
import {
  object,
  strictObject,
  string,
  number,
  boolean,
  array,
  unknown,
  optional,
  pipeAsync,
  checkAsync,
  record,
  file,
} from '@zeruxjs/validator/browser';
import { createFormFeedback } from '@zeruxjs/validator/browser';
import {
  createHttpInputAdapter,
  parseQuery,
  parseHeaders,
  parseFormData,
  parseFormRequest,
  parseJsonRequest,
  readJsonBody,
  validatedJsonHandler,
  HttpValidationError,
} from '@zeruxjs/validator/http';

/** Create an in-memory Fetch request, including the Node duplex flag only for stream bodies.
 * @param {BodyInit} body - Exact local fixture bytes or deliberately stalled stream.
 * @param {HeadersInit} headers - Explicit media/length policy headers, default JSON.
 * @param {AbortSignal} signal - Optional request cancellation signal controlled by the fixture.
 * @returns {Request} Synthetic request without a network server or remote fetch. */
const request = (
  body,
  headers = { 'content-type': 'application/json' },
  signal
) =>
  new Request('https://input.test/', {
    method: 'POST',
    headers,
    body,
    signal,
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  });
/** Build a private HTTP error/status assertion predicate.
 * @param {number} expected - Exact status the fixture requires.
 * @returns {(error: unknown) => boolean} Predicate requiring both package error identity and matching status. */
const status = (expected) => (error) =>
  error instanceof HttpValidationError && error.status === expected;
/** Create an intentionally uncooperative synthetic reader to exercise deadline/cancellation paths.
 * @returns {object} Stream plus cancellation counter; pending pull promises never represent a real socket or provider. */
const stalled = () => {
  let cancellations = 0;
  /** Synthetic stream whose callbacks exercise explicit body failure/cancellation behavior without network I/O. */
  const stream = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
    cancel() {
      cancellations++;
    },
  });
  return {
    stream,
    get cancellations() {
      return cancellations;
    },
  };
};

test('body bounds reject size, length mismatch, content type and compressed input; cleanup frees slots', async () => {
  /** Test-owned reader adapter; assertions/finally blocks verify its slot release and close semantics. */
  const adapter = createHttpInputAdapter({
    maxBytes: 10,
    maxConcurrentReads: 1,
  });
  try {
    // Each rejected header policy must cancel its source and release the instance reader slot.
    for (const [headers, expected] of [
      [{ 'content-type': 'text/plain' }, 415],
      [{ 'content-type': 'application/json', 'content-length': '11' }, 413],
      [{ 'content-type': 'application/json', 'content-encoding': 'gzip' }, 415],
      [{ 'content-type': 'application/json; charset=iso-8859-1' }, 415],
    ]) {
      /** Deliberately stalled synthetic source whose cancellation count and lock state are asserted. */
      const source = stalled();
      await assert.rejects(
        adapter.readJsonBody(request(source.stream, headers)),
        status(expected)
      );
      assert.equal(source.cancellations, 1);
      assert.equal(source.stream.locked, false);
    }
    let cancelled = 0;
    /** Synthetic oversized stream testing early byte rejection and source cancellation. */
    const large = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('"' + 'x'.repeat(20) + '"')
        );
      },
      cancel() {
        cancelled++;
      },
    });
    await assert.rejects(adapter.readJsonBody(request(large)), status(413));
    assert.equal(cancelled, 1);
    assert.equal(large.locked, false);
    await assert.rejects(
      adapter.readJsonBody(
        request('{}', {
          'content-type': 'application/json',
          'content-length': '3',
        })
      ),
      status(400)
    );
    assert.deepEqual(await adapter.readJsonBody(request('{}')), {});
  } finally {
    await adapter.close();
  }
});

test('absolute deadlines interrupt slow readers, including uncooperative cancellation', async () => {
  let cancellations = 0;
  /** Synthetic stream whose callbacks exercise explicit body failure/cancellation behavior without network I/O. */
  const stream = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
    cancel() {
      cancellations++;
      return new Promise(() => {});
    },
  });
  /** Test-owned reader adapter; assertions/finally blocks verify its slot release and close semantics. */
  const adapter = createHttpInputAdapter({
    bodyTimeoutMs: 20,
    maxConcurrentReads: 1,
  });
  try {
    await assert.rejects(adapter.readJsonBody(request(stream)), status(408));
    assert.equal(cancellations, 1);
    assert.equal(stream.locked, false);
    assert.deepEqual(await adapter.readJsonBody(request('{}')), {});
  } finally {
    await adapter.close();
  }
});

test('reader deadline does not reset for trickled bytes', async () => {
  let timer,
    cancellations = 0;
  /** Synthetic stream whose callbacks exercise explicit body failure/cancellation behavior without network I/O. */
  const stream = new ReadableStream({
    start(controller) {
      timer = setInterval(
        () => controller.enqueue(new TextEncoder().encode(' ')),
        4
      );
    },
    cancel() {
      cancellations++;
      clearInterval(timer);
    },
  });
  try {
    await assert.rejects(
      readJsonBody(request(stream), { bodyTimeoutMs: 25 }),
      status(408)
    );
  } finally {
    clearInterval(timer);
  }
  assert.equal(cancellations, 1);
  assert.equal(stream.locked, false);
});

test('disconnects and owner close cancel active readers, with bounded concurrency', async () => {
  /** Test-owned reader adapter; assertions/finally blocks verify its slot release and close semantics. */
  const adapter = createHttpInputAdapter({
    bodyTimeoutMs: 1000,
    maxConcurrentReads: 1,
  });
  /** First stalled reader source used to occupy the explicit per-adapter slot. */
  const first = stalled();
  /** Rejected competing source whose cancellation proves overload does not retain its reader. */
  const second = stalled();
  /** Fixture-owned request cancellation controller; the test explicitly aborts it. */
  const controller = new AbortController();
  /** Started synthetic read observed through rejection assertions before checking release. */
  const pending = adapter.readJsonBody(
    request(first.stream, undefined, controller.signal)
  );
  // operation dispatch takes one microtask before acquiring the reader slot.
  await Promise.resolve();
  await assert.rejects(
    adapter.readJsonBody(request(second.stream)),
    status(429)
  );
  assert.equal(second.cancellations, 1);
  controller.abort(new Error('private disconnect reason'));
  await assert.rejects(pending, (error) => status(400)(error) && !!error.cause);
  assert.equal(first.cancellations, 1);
  assert.equal(first.stream.locked, false);
  /** Synthetic source whose active read must settle after adapter close. */
  const closing = stalled();
  /** Read promise whose rejection is registered before the adapter is closed. */
  const active = adapter.readJsonBody(request(closing.stream));
  /** Registered rejection assertion awaited after close to avoid treating cancellation as an unhandled failure. */
  const observed = assert.rejects(active, status(400));
  await Promise.resolve();
  await adapter.close();
  await observed;
  assert.equal(closing.cancellations, 1);
  await assert.rejects(adapter.readJsonBody(request('{}')), /closed/);
  await adapter.close();
});

test('stream dependency failure retains cause and gives sanitized response', async () => {
  /** Private dependency error or failing feedback owner; fixtures verify propagation/restoration without leaking values. */
  const failure = new Error('private password: do not expose');
  /** Synthetic stream whose callbacks exercise explicit body failure/cancellation behavior without network I/O. */
  const stream = new ReadableStream({
    pull(controller) {
      controller.error(failure);
    },
  });
  let error;
  try {
    await readJsonBody(request(stream));
  } catch (caught) {
    error = caught;
  }
  assert.equal(error.status, 400);
  assert.equal(error.cause.error, failure);
  assert.equal(stream.locked, false);
  /** Synthetic response used to assert status, no-store policy and sanitized client data. */
  const response = error.toResponse();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(await response.text(), /password|private|stack|cause/);
});

test('shared field policies cover repeats, absence, empty values and strict coercion', async () => {
  /** Explicit repeated-field array schema, separate from raw duplicate occurrence selection. */
  const repeated = object({ tag: array(string()) });
  assert.deepEqual(
    await parseQuery(repeated, 'https://input.test/?tag=a&tag=b'),
    { tag: ['a', 'b'] }
  );
  await assert.rejects(
    parseQuery(repeated, 'https://input.test/?tag=a&tag=b', {
      duplicates: 'reject',
    }),
    status(400)
  );
  assert.deepEqual(
    await parseQuery(
      object({ tag: string() }),
      'https://input.test/?tag=a&tag=b',
      { duplicates: 'last' }
    ),
    { tag: 'b' }
  );
  /** Declared fixture schema for field coercion, own properties or native File preservation. */
  const schema = object({
    n: optional(number(), 5),
    flag: boolean(),
    name: optional(string()),
  });
  /** Explicit empty/coercion field policy; there is no schema-driven implicit type coercion. */
  const options = { coerce: { n: 'number', flag: 'boolean' }, empty: 'omit' };
  assert.deepEqual(
    await parseQuery(
      schema,
      'https://input.test/?n=&flag=false&name=',
      options
    ),
    { n: 5, flag: false }
  );
  // Reject each ambiguous numeric spelling rather than applying broad Number coercion.
  for (const n of ['0x10', 'Infinity', 'NaN', ' 2', '']) {
    await assert.rejects(
      parseQuery(
        object({ n: number() }),
        'https://input.test/?n=' + encodeURIComponent(n),
        { coerce: { n: 'number' } }
      ),
      status(400)
    );
  }
  await assert.rejects(
    parseQuery(object({ n: number() }), 'https://input.test/?n=2'),
    status(422)
  );
  /** Prototype-safe parsed field dictionary; no submitted path is expanded into an object graph. */
  const raw = await parseQuery(unknown(), 'https://input.test/?name=A');
  assert.equal(Object.getPrototypeOf(raw), null);
  await assert.rejects(
    parseQuery(
      strictObject({ name: string() }),
      'https://input.test/?name=A&extra=1'
    ),
    status(422)
  );
  // Reject reserved and path-like pollution keys without interpreting them as nested properties.
  for (const key of [
    '__proto__',
    'constructor',
    'prototype',
    'user[__proto__]',
    'user.constructor',
  ]) {
    await assert.rejects(
      parseQuery(
        unknown(),
        'https://input.test/?' + encodeURIComponent(key) + '=x'
      ),
      status(400)
    );
  }
  await assert.rejects(
    parseJsonRequest(unknown(), request('{"nested":{"__proto__":{}}}')),
    status(400)
  );
});

test('headers lower-case names and use the same duplicate/coercion rules', async () => {
  /** Declared fixture schema for field coercion, own properties or native File preservation. */
  const schema = object({ 'x-count': number() });
  assert.deepEqual(
    await parseHeaders(
      schema,
      [
        ['X-Count', '1'],
        ['x-count', '2'],
      ],
      { duplicates: 'first', coerce: { 'x-count': 'number' } }
    ),
    { 'x-count': 1 }
  );
  await assert.rejects(
    parseHeaders(
      schema,
      [
        ['X-Count', '1'],
        ['x-count', '2'],
      ],
      { duplicates: 'reject' }
    ),
    status(400)
  );
  await assert.rejects(
    parseHeaders(unknown(), [['Bad Name', 'private']]),
    status(400)
  );
  await assert.rejects(
    parseHeaders(unknown(), [['__proto__', 'private']]),
    status(400)
  );
  // Native Headers has already merged wire duplicates; commas are never split.
  /** Native Headers fixture whose duplicate wire fields have already been merged. */
  const native = new Headers([
    ['X-Name', 'a'],
    ['X-Name', 'b'],
  ]);
  assert.deepEqual(await parseHeaders(object({ 'x-name': string() }), native), {
    'x-name': 'a, b',
  });
});

test('URL-encoded and multipart forms share field policies; file content is never read by callbacks', async () => {
  /** Declared fixture schema for field coercion, own properties or native File preservation. */
  const schema = object({ name: string(), n: number() });
  assert.deepEqual(
    await parseFormRequest(
      schema,
      request('name=A&n=2', {
        'content-type': 'application/x-www-form-urlencoded',
      }),
      { coerce: { n: 'number' } }
    ),
    { name: 'A', n: 2 }
  );
  /** Local multipart form fixture; parser checks metadata and never fetches attachment URLs. */
  const form = new FormData();
  form.append('name', 'A');
  form.append('n', '2');
  assert.deepEqual(
    await parseFormRequest(
      schema,
      new Request('https://input.test/', { method: 'POST', body: form }),
      { coerce: { n: 'number' } }
    ),
    { name: 'A', n: 2 }
  );
  form.append('n', '3');
  await assert.rejects(
    parseFormData(schema, form, { duplicates: 'reject' }),
    status(400)
  );
  /** Local form holding a synthetic private File solely for metadata-preservation checks. */
  const upload = new FormData();
  upload.append(
    'attachment',
    new File(['private-file-contents'], 'private.txt')
  );
  await assert.rejects(parseFormData(unknown(), upload), status(400));
  /** Parsed form result retaining the caller-owned File object and its size metadata. */
  const result = await parseFormData(object({ attachment: file() }), upload, {
    files: 'preserve',
  });
  assert.equal(result.attachment.size, 21);
  await assert.rejects(
    parseFormRequest(
      unknown(),
      request('invalid', { 'content-type': 'multipart/form-data' })
    ),
    status(400)
  );
  await assert.rejects(
    parseFormRequest(
      unknown(),
      request('a=b', { 'content-type': 'text/plain' })
    ),
    status(415)
  );
});

test('schema failures keep private causes, redact dynamic keys and never mask dependency errors', async () => {
  /** Owned validating handler; its existing finally block closes the adapter even on assertion failure. */
  const handler = validatedJsonHandler(
    object({ password: number() }),
    () => ({})
  );
  try {
    /** Synthetic response used to assert status, no-store policy and sanitized client data. */
    const response = await handler(request('{"password":"private-password"}'));
    /** Client response JSON inspected to prove private input/diagnostics are not echoed. */
    const body = await response.json();
    assert.equal(response.status, 422);
    assert.equal(body.issues[0].path, 'password');
    assert.equal(body.issues[0].code, 'schema.number');
    assert.doesNotMatch(
      JSON.stringify(body),
      /private-password|expected|received/
    );
  } finally {
    await handler.close();
  }
  let rejected;
  try {
    await parseJsonRequest(
      record(string(), number()),
      request('{"private-password":"private-value"}')
    );
  } catch (error) {
    rejected = error;
  }
  assert.ok(rejected.cause);
  assert.doesNotMatch(
    await rejected.toResponse().text(),
    /private-password|private-value/
  );
  /** Private dependency error or failing feedback owner; fixtures verify propagation/restoration without leaking values. */
  const failure = new Error('validator dependency failed');
  await assert.rejects(
    parseQuery(
      pipeAsync(
        unknown(),
        checkAsync(async () => {
          throw failure;
        })
      ),
      'https://input.test/'
    ),
    (error) => error === failure
  );
});

/** Construct a minimal in-memory attribute/text fixture; it is not a live DOM or keyboard qualification.
 * @param {Record<string, string>} attributes - Initial authored attribute map.
 * @param {string} textContent - Initial inert description text.
 * @returns {object} Borrowed attribute/text surface consumed by the feedback helper.
 */
function element(attributes = {}, textContent = '') {
  /** Local attribute map backing the minimal feedback fixture; no browser or DOM globals are required. */
  const attrs = new Map(Object.entries(attributes));
  return {
    textContent,
    getAttribute: (key) => attrs.get(key) ?? null,
    setAttribute: (key, value) => attrs.set(key, value),
    removeAttribute: (key) => attrs.delete(key),
  };
}

test('feedback uses explicit field callbacks, safe text and restorable ARIA descriptions', () => {
  /** Synthetic field-control surface with authored ARIA attributes to restore. */
  const control = element({ 'aria-describedby': 'hint' });
  /** Synthetic inert description surface whose text and attributes must restore on cleanup. */
  const description = element({ id: 'name-error' }, 'Original');
  /** Local notification snapshots; assertions permit sanitized issue codes only. */
  const events = [];
  /** Test-owned feedback scope, explicitly cleared/destroyed to prove attribute/text restoration. */
  const feedback = createFormFeedback({
    resolveField: (path) =>
      path === 'name' ? { control, description } : undefined,
    onIssue: (event) => events.push(event),
  });
  feedback.update([
    {
      path: 'name',
      code: 'schema.string',
      message: 'private-password <script>',
    },
  ]);
  assert.equal(control.getAttribute('aria-invalid'), 'true');
  assert.equal(control.getAttribute('aria-describedby'), 'hint name-error');
  assert.equal(description.textContent, 'Invalid input');
  assert.deepEqual(events, [{ code: 'schema.string' }]);
  feedback.clear();
  assert.equal(control.getAttribute('aria-invalid'), null);
  assert.equal(control.getAttribute('aria-describedby'), 'hint');
  assert.equal(description.textContent, 'Original');
  feedback.destroy();
  feedback.destroy();
  assert.throws(() => feedback.update([]), /destroyed/);
  /** Private dependency error or failing feedback owner; fixtures verify propagation/restoration without leaking values. */
  const failure = createFormFeedback({
    resolveField: () => ({ control, description }),
    onIssue() {
      throw new Error('hook failed');
    },
  });
  assert.throws(
    () => failure.update([{ path: 'name', message: 'private' }]),
    /hook failed/
  );
  assert.equal(control.getAttribute('aria-invalid'), null);
  assert.equal(description.textContent, 'Original');
  failure.destroy();
});

test('browser entry bundles without Node globals or request parsers', async (t) => {
  /** Owned temporary emitted-browser fixture directory, recursively removed in finally. */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validator-browser-'));
  try {
    /** Real emitted public browser entry path; no source alias bypasses package boundaries. */
    const entry = path.resolve(import.meta.dirname, '../dist/browser.js');
    /** Owned temporary browser bundle destination under the fixture directory. */
    const output = path.join(root, 'browser.js');
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
    // Trace real emitted imports, including cycles/reexports, without source aliases.
    /** Canonical emitted paths already inspected, bounding recursive import cycles. */
    const visited = new Set();
    /** Walk actual emitted browser imports with a cycle guard; modules are read as text, not executed.
     * @param {string} filename - Current emitted local module path.
     * @returns {void} Verifies relative-only dependency boundaries; missing files and rejected imports fail the fixture.
     */
    function trace(filename) {
      filename = fs.realpathSync(filename);
      if (visited.has(filename)) {
        return;
      }
      visited.add(filename);
      assert.doesNotMatch(
        filename,
        /integrations\/(?:http|body|fields|issues)\.js$/
      );
      // Inspect every emitted import/reference and recurse only into relative local paths.
      for (const item of ts.preProcessFile(
        fs.readFileSync(filename, 'utf8'),
        true,
        true
      ).importedFiles) {
        assert.ok(
          item.fileName.startsWith('.'),
          `Unexpected browser dependency: ${item.fileName}`
        );
        trace(path.resolve(path.dirname(filename), item.fileName));
      }
    }
    trace(entry);
    await buildTypescript({
      entryPoints: [entry],
      outdir: root,
      bundle: true,
      platform: 'browser',
      format: 'esm',
      target: 'es2022',
      sourcemap: false,
    });
    /** Emitted browser bundle text; syntax and actual imports are checked independently. */
    const code = fs.readFileSync(output, 'utf8');
    // Inspect executable syntax instead of comments: documentation can name a Node API without importing or invoking it.
    /** Parsed emitted JavaScript; trivia is excluded from executable identifier checks. */
    const syntax = ts.createSourceFile(
      output,
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    );
    /** Executable identifiers and computed/module reference literals, never documentation text. */
    const executableNames = [];
    /** Collect executable Node references conservatively, including property and computed access.
     * @param {import('typescript').Node} node - Current emitted JavaScript syntax node.
     * @returns {void} Adds relevant executable names; comments and unrelated string values remain inert.
     */
    function inspectExecutableNames(node) {
      if (
        ts.isIdentifier(node) ||
        (ts.isStringLiteral(node) &&
          (ts.isElementAccessExpression(node.parent) ||
            ts.isImportDeclaration(node.parent) ||
            ts.isExportDeclaration(node.parent) ||
            (ts.isCallExpression(node.parent) &&
              node.parent.expression.kind === ts.SyntaxKind.ImportKeyword)))
      ) {
        executableNames.push(node.text);
      }
      ts.forEachChild(node, inspectExecutableNames);
    }
    inspectExecutableNames(syntax);
    assert.doesNotMatch(
      executableNames.join('\n'),
      /\b(?:process|Buffer|require)\b|node:/
    );
    await t.test(
      'syntax guard ignores documentation but rejects executable Node references',
      () => {
        /** Inspect synthetic source as syntax only; no fixture code is executed.
         * @param {string} source - Authored synthetic JavaScript probe parsed without evaluation.
         * @returns {void} Rejects executable Node references while ignoring documentation/inert strings.
         */
        const checkFixture = (source) => {
          executableNames.length = 0;
          inspectExecutableNames(
            ts.createSourceFile(
              output,
              source,
              ts.ScriptTarget.Latest,
              true,
              ts.ScriptKind.JS
            )
          );
          assert.doesNotMatch(
            executableNames.join('\n'),
            /\b(?:process|Buffer|require)\b|node:/
          );
        };
        assert.doesNotThrow(() =>
          checkFixture(
            '/* process Buffer require node: are inert documentation. */ const value = "process is data";'
          )
        );
        // Every fixture is parsed only: even module and computed-access probes start no Node work.
        for (const source of [
          'process.env',
          'Buffer.from("x")',
          'require("node:fs")',
          'globalThis["process"]',
          'import("node:fs")',
        ]) {
          assert.throws(() => checkFixture(source), assert.AssertionError);
        }
      }
    );
    /** Imported local emitted browser fixture; this is Node execution with no DOM, not browser qualification. */
    const browser = await import(pathToFileURL(output).href);
    assert.equal(browser.parse(browser.string(), 'A'), 'A');
    assert.equal('parseJsonRequest' in browser, false);
    assert.equal(typeof browser.createFormFeedback, 'function');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
