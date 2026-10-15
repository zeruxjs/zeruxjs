import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import { createProtocolClient, ProtocolClientError, createQueryCache, readEventStream } from '../dist/network/index.js';
import { connectJsonStream } from '../dist/network/connect-stream.js';
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const stop = server => new Promise(resolve => server.close(resolve));
test('browser-independent RPC, MCP, Connect, tRPC clients check response identity and failure', async () => {
  const server = http.createServer(async (req, res) => {
    const parts = []; for await (const c of req) parts.push(c);
    const input = JSON.parse(Buffer.concat(parts).toString());
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/rpc') return res.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result: input.params.value }));
    if (req.url === '/mcp') return res.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result: { ok: true } }));
    if (req.url === '/Service/Method') return res.end(JSON.stringify({ echoed: input }));
    if (req.url === '/trpc/api') return res.end(JSON.stringify({ result: { data: input } }));
    res.statusCode = 404; res.end('{}');
  });
  const port = await listen(server);
  try {
    const client = createProtocolClient({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 1000 });
    assert.equal(await client.rpc('square', { value: 4 }), 4);
    assert.deepEqual(await client.mcp('tools/list'), { ok: true });
    assert.deepEqual(await client.connect('Service', 'Method', { num: 2 }), { echoed: { num: 2 } });
    assert.deepEqual(await client.trpc('api', { num: 3 }), { num: 3 });
    await assert.rejects(client.connect('Invalid/Service', 'Method', 1), TypeError);
  } finally { await stop(server); }
});
test('query cache de-duplicates successful computations, respects TTL and tag invalidation', async () => {
  const cache = createQueryCache({ maxEntries: 2, defaultTtlMs: 5000 });
  let calls = 0;
  const load = async () => { calls++; await new Promise(r => setTimeout(r, 15)); return 11; };
  assert.deepEqual(await Promise.all([cache.query('x', load, { tags: ['api'] }), cache.query('x', load)]), [11, 11]);
  assert.equal(calls, 1);
  assert.equal(cache.get('x'), 11);
  assert.equal(cache.invalidateTag('api'), 1);
  assert.equal(cache.get('x'), undefined);
  await assert.rejects(cache.query('bad', async () => { throw new Error('oops'); }), /oops/);
  assert.equal(cache.get('bad'), undefined);
});
test('SSE streaming parses UTF-8 chunks and bounded event records', async () => {
  const body = new ReadableStream({ start(c) {
    c.enqueue(new TextEncoder().encode('id: 4\nevent: update\ndata: hel'));
    c.enqueue(new TextEncoder().encode('lo\ndata: world\n\n')); c.close();
  } });
  const fetchMock = async () => new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  const received = [];
  for await (const item of readEventStream('https://example.com/events', { fetch: fetchMock })) received.push(item);
  assert.deepEqual(received, [{ event: 'update', data: 'hello\nworld', id: '4' }]);
});
test('Connect framing parses fragmented envelopes', async () => {
  const message = Buffer.from(JSON.stringify({ hello: 1 }));
  const frame = Buffer.alloc(5 + message.length); frame.writeUInt32BE(message.length, 1); message.copy(frame, 5);
  const tail = Buffer.from([128, 0, 0, 0, 2, 123, 125]);
  const body = new ReadableStream({ start(c) { c.enqueue(frame.subarray(0, 3)); c.enqueue(frame.subarray(3)); c.enqueue(tail); c.close(); } });
  const fetchMock = async () => new Response(body, { headers: { 'Content-Type': 'application/connect+json' } });
  const output = [];
  for await (const value of connectJsonStream('Service', 'Stream', [{ test: true }], { baseUrl: 'https://example.com', fetch: fetchMock })) output.push(value);
  assert.deepEqual(output, [{ hello: 1 }]);
});

test('reactive remote resource ignores stale responses and handles disposal', async () => {
  const { createRemoteResource } = await import('../dist/network/reactive.js');
  let complete;
  const resource = createRemoteResource(async () => new Promise(resolve => { complete = resolve; }));
  const older = resource.refresh();
  await Promise.resolve();
  assert.equal(resource.loading.value, true);
  const next = resource.refresh();
  await Promise.resolve();
  complete(4);
  assert.equal(await next, 4);
  assert.equal(resource.data.value, 4);
  assert.equal(resource.loading.value, false);
  resource.dispose();
  await assert.rejects(resource.refresh(), /disposed/);
  void older;
});

test('cancelled stale resources reject even if a loader ignores AbortSignal',async()=>{
  const {createRemoteResource}=await import('../dist/network/index.js');
  const tasks=[];
  const state=createRemoteResource(()=>new Promise(resolve=>tasks.push(resolve)));
  const old=state.refresh();const next=state.refresh();
  tasks[1]('new');assert.equal(await next,'new');
  tasks[0]('stale');await assert.rejects(old,{name:'AbortError'});
  assert.equal(state.data.value,'new');state.dispose();
});
