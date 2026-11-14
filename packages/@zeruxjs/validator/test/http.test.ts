import test from 'node:test';
import assert from 'node:assert/strict';
import {
  object,
  string,
  array,
  HttpValidationError,
  parseJsonRequest,
  parseQuery,
  readJsonBody,
  validatedJsonHandler,
} from '../dist/index.js';

/** Create a synthetic JSON request without opening a network listener.
 * @param {BodyInit} body - Exact fixture bytes to exercise decoding limits.
 * @param {HeadersInit} headers - Explicit fixture media/length headers.
 * @returns {Request} In-memory request; no application or remote service starts. */
const make = (body, headers = { 'content-type': 'application/json' }) =>
  new Request('https://api.test/', { method: 'POST', headers, body });
test('validated JSON request returns parsed typed body', async () => {
  /** Explicit fixture schema for the expected own fields and repeated-array behavior. */
  const schema = object({ name: string() });
  assert.deepEqual(await parseJsonRequest(schema, make('{"name":"Ada"}')), {
    name: 'Ada',
  });
});
test('rejects malformed JSON and unsafe media type with clear status', async () => {
  await assert.rejects(
    () => readJsonBody(make('{not json')),
    (e) => e instanceof HttpValidationError && e.status === 400
  );
  await assert.rejects(
    () => readJsonBody(make('hello', { 'content-type': 'text/plain' })),
    (e) => e instanceof HttpValidationError && e.status === 415
  );
});
test('rejects oversized streamed JSON before parsing', async () => {
  await assert.rejects(
    () =>
      readJsonBody(make('{"long":"' + 'x'.repeat(100) + '"}'), {
        maxBytes: 12,
      }),
    (e) => e.status === 413
  );
});
test('reports invalid schemas as safe validation errors', async () => {
  await assert.rejects(
    () => parseJsonRequest(object({ name: string() }), make('{"name":3}')),
    (e) => e.status === 422 && e.issues.length > 0
  );
});
test('validating handler returns response with bounded error details', async (t) => {
  /** Test-owned validating handler; test teardown closes its adapter even if an assertion fails. */
  const handler = validatedJsonHandler(object({ name: string() }), (body) => ({
    name: body.name.toUpperCase(),
  }));
  t.after(() => handler.close());
  /** Successful synthetic response whose parsed body proves the handler receives validated input. */
  const good = await handler(make('{"name":"Ada"}'));
  assert.deepEqual(await good.json(), { name: 'ADA' });
  /** Denied synthetic response used to inspect bounded private/no-store error publication. */
  const bad = await handler(make('{"name":42}'));
  assert.equal(bad.status, 422);
  assert.equal(bad.headers.get('cache-control'), 'no-store');
});
test('query parsing validates repeated parameters and rejects pollution', async () => {
  /** Explicit fixture schema for the expected own fields and repeated-array behavior. */
  const schema = object({ tags: array(string()) });
  /** Parsed repeated-query fixture; submitted field order is intentionally preserved. */
  const result = await parseQuery(schema, 'https://site.test/?tags=a&tags=b');
  assert.deepEqual(result.tags, ['a', 'b']);
  await assert.rejects(
    () => parseQuery(schema, 'https://site.test/?__proto__=bad&tags=a'),
    (e) => e.status === 400
  );
  await assert.rejects(
    () =>
      parseQuery(schema, 'https://site.test/?tags=a&tags=b', {
        maxQueryFields: 1,
      }),
    (e) => e.status === 413
  );
});

test('bounded query URL and void handler responses', async (t) => {
  /** Explicit fixture schema for the expected own fields and repeated-array behavior. */
  const schema = object({ name: string() });
  await assert.rejects(
    () =>
      parseQuery(schema, 'https://site.test/?name=abcdef', {
        maxQueryLength: 10,
      }),
    (e) => e.status === 413
  );
  /** Test-owned validating handler; test teardown closes its adapter even if an assertion fails. */
  const handler = validatedJsonHandler(schema, () => undefined);
  t.after(() => handler.close());
  /** Synthetic no-content handler result; no live server or browser is involved. */
  const response = await handler(make('{"name":"Ada"}'));
  assert.equal(response.status, 204);
});
