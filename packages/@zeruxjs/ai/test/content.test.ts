import test from 'node:test';
import assert from 'node:assert/strict';
import { object, string } from '@zeruxjs/validator';
import {
  createAnthropicProvider,
  createGeminiProvider,
  withRetry,
  createAiProviderRegistry,
} from '@zeruxjs/ai';
/** Opaque tiny binary fixture; transport mapping is tested, not real media/codec decoding. */
const bytes = new Uint8Array([1, 2, 3, 4]);
/**
 * Build a minimal supported native buffered response without model inference.
 * @param {string} kind - Fixture native adapter kind.
 * @returns {object} Synthetic first-choice/text response with a terminal reason.
 */
const nativeResponse = (kind) =>
  kind === 'anthropic'
    ? { content: [{ type: 'text', text: 'accepted' }], stop_reason: 'end_turn' }
    : {
        candidates: [
          { content: { parts: [{ text: 'accepted' }] }, finishReason: 'STOP' },
        ],
      };
// Exercise equivalent inert wire behavior independently for both native adapters.
for (const kind of ['anthropic', 'gemini']) {
  test(`${kind} encodes mixed image/PDF/source/JSON as inert bounded parts`, async () => {
    let body;
    /** Private synthetic configuration; dummy credentials never authorize an external service. */
    const config = {
      apiKey: 'fixture',
      model: 'fixture',
      maxRequestBytes: 1048576,
      fetch: async (_, init) => {
        body = JSON.parse(init.body);
        return new Response(JSON.stringify(nativeResponse(kind)));
      },
    };
    /** Synthetic provider fixture; injected methods/transport avoid live model calls. */
    const p =
      kind === 'anthropic'
        ? createAnthropicProvider({ ...config, apiVersion: '2026-10-21' })
        : createGeminiProvider(config);
    /** Deliberately executable-looking inert data; assertions verify no code/tool execution occurs. */
    const dangerous =
      'globalThis.__aiExecuted = true; import("node:child_process").then(m=>m.execSync("bad"));';
    delete globalThis.__aiExecuted;
    /** Observed fixture result, asserted below without executing any returned strings. */
    const result = await p.chatContent([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Review the supplied data' },
          {
            type: 'file',
            filename: 'server.ts',
            language: 'typescript',
            text: dangerous,
          },
          {
            type: 'json',
            value: {
              tool: 'shell',
              arguments: { command: 'bad' },
              html: '<script>bad()</script>',
            },
          },
          { type: 'image', mimeType: 'image/png', data: bytes },
          { type: 'pdf', mimeType: 'application/pdf', data: bytes },
        ],
      },
    ]);
    assert.equal(result.text, 'accepted');
    assert.equal(globalThis.__aiExecuted, undefined);
    /** Captured outbound wire parts; assertions inspect mapping rather than evaluating their text. */
    const parts =
      kind === 'anthropic' ? body.messages[0].content : body.contents[0].parts;
    assert.match(parts[1].text, /node:child_process/);
    assert.equal(JSON.parse(parts[2].text).tool, 'shell');
    if (kind === 'anthropic') {
      assert.equal(parts[3].type, 'image');
      assert.equal(parts[4].type, 'document');
      assert.equal(parts[3].source.data, 'AQIDBA==');
    } else {
      assert.equal(parts[3].inlineData.mimeType, 'image/png');
      assert.equal(parts[4].inlineData.mimeType, 'application/pdf');
    }
    assert.equal(body.tools, undefined);
    assert.equal(p.capabilities.tools, false);
  });
}
test('Gemini accepts inline video/audio; Anthropic rejects unsupported media before network', async () => {
  let calls = 0,
    body;
  /** Private synthetic configuration; dummy credentials never authorize an external service. */
  const config = {
    apiKey: 'x',
    model: 'fixture',
    fetch: async (_, init) => {
      calls++;
      body = JSON.parse(init.body);
      return new Response(JSON.stringify(nativeResponse('gemini')));
    },
  };
  /** Synthetic media/message envelope whose wire mapping or denial is checked before network work. */
  const input = [
    {
      role: 'user',
      content: [
        { type: 'video', mimeType: 'video/mp4', data: bytes },
        { type: 'audio', mimeType: 'audio/wav', data: bytes },
      ],
    },
  ];
  /** Injected Gemini fixture for its explicit inline audio/video MIME subset. */
  const gemini = createGeminiProvider(config);
  await gemini.chatContent(input);
  assert.equal(body.contents[0].parts[0].inlineData.mimeType, 'video/mp4');
  assert.ok(gemini.capabilities.inputs.includes('video'));
  await assert.rejects(
    createAnthropicProvider({
      ...config,
      apiVersion: '2026-10-21',
    }).chatContent(input),
    /Unsupported/
  );
  assert.equal(calls, 1);
});
test('paths/URLs/executable objects, invalid MIME, role misuse and budgets deny before transport', async () => {
  let calls = 0;
  /** Synthetic provider fixture; injected methods/transport avoid live model calls. */
  const p = createGeminiProvider({
    apiKey: 'x',
    model: 'fixture',
    content: { maxMediaBytes: 3, maxParts: 2 },
    fetch: async () => {
      calls++;
      throw Error('must not open');
    },
  });
  /**
   * Submit a synthetic part list to the injected content adapter.
   * @param {object[]} content - Untrusted fixture parts expected to pass or fail before transport.
   * @returns {Promise<object>} Buffered fixture outcome or expected validation rejection.
   */
  const send = (content) => p.chatContent([{ role: 'user', content }]);
  // Reject each malformed part before the injected transport observes a request.
  for (const part of [
    { type: 'image', mimeType: 'image/svg+xml', data: bytes },
    {
      type: 'image',
      mimeType: 'image/png',
      data: 'https://attacker.test/file',
    },
    { type: 'file', filename: '../../secret.env', text: 'x' },
    {
      type: 'file',
      filename: 'file.js',
      text: () => {
        throw Error('never');
      },
    },
    { type: 'image', mimeType: 'image/png', data: bytes },
    { type: 'text', text: 'x', url: 'file:///etc/passwd' },
  ]) {
    await assert.rejects(send([part]));
  }
  let getter = false;
  /** Accessor-backed negative input; validation must reject without running the getter. */
  const malicious = {
    type: 'text',
    get text() {
      getter = true;
      return 'bad';
    },
  };
  await assert.rejects(send([malicious]));
  assert.equal(getter, false);
  await assert.rejects(
    send(Array.from({ length: 3 }, () => ({ type: 'text', text: 'x' })))
  );
  await assert.rejects(
    p.chatContent([
      {
        role: 'system',
        content: [
          { type: 'image', mimeType: 'image/png', data: new Uint8Array([1]) },
        ],
      },
    ])
  );
  assert.equal(calls, 0);
  /** Provider policy narrows accepted input kinds before transport admission. */
  const restricted = createGeminiProvider({
    apiKey: 'x',
    model: 'fixture',
    content: { allowedInputs: ['text'] },
  });
  await assert.rejects(
    restricted.chatContent([
      { role: 'user', content: [{ type: 'json', value: { x: 1 } }] },
    ])
  );
});
// Exercise equivalent inert wire behavior independently for both native adapters.
for (const kind of ['anthropic', 'gemini']) {
  test(`${kind} requests and validates JSON output without interpreting commands`, async () => {
    let body;
    /** Declarative output schema plus independent validator; provider claims alone are insufficient. */
    const schema = {
      type: 'object',
      properties: { code: { type: 'string' } },
      required: ['code'],
      additionalProperties: false,
    };
    /** Explicit native JSON request with a trusted local validator, not a prompt-only constraint. */
    const output = {
      type: 'json',
      schema,
      validator: object({ code: string() }),
    };
    /** Deliberate wire/text fixture used to check bounds and inertness. */
    const payload = {
      code: 'import("node:fs"); globalThis.__aiExecuted = true;',
    };
    /** Synthetic provider wire envelope; it contains no verified model inference. */
    const response = nativeResponse(kind);
    if (kind === 'anthropic') {
      response.content[0].text = JSON.stringify(payload);
    } else {
      response.candidates[0].content.parts[0].text = JSON.stringify(payload);
    }
    /** Private synthetic configuration; dummy credentials never authorize an external service. */
    const config = {
      apiKey: 'x',
      model: 'fixture',
      fetch: async (_, init) => {
        body = JSON.parse(init.body);
        return new Response(JSON.stringify(response));
      },
    };
    /** Synthetic provider fixture; injected methods/transport avoid live model calls. */
    const p = withRetry(
      kind === 'anthropic'
        ? createAnthropicProvider({ ...config, apiVersion: '2026-10-21' })
        : createGeminiProvider(config)
    );
    delete globalThis.__aiExecuted;
    /** Application-local borrowed-provider registry; the fixture controls registration and close. */
    const registry = createAiProviderRegistry();
    registry.register('model', p);
    try {
      /** Observed response/receipt used to assert validation, accounting or retrieval behavior. */
      const r = await registry
        .get('model', ['jsonOutput'])
        .chatContent(
          [{ role: 'user', content: 'Return source code as JSON data' }],
          { output }
        );
      assert.deepEqual(r.data, payload);
      assert.equal(globalThis.__aiExecuted, undefined);
      if (kind === 'anthropic') {
        assert.deepEqual(body.output_config.format.schema, schema);
      } else {
        assert.equal(
          body.generationConfig.responseMimeType,
          'application/json'
        );
        assert.deepEqual(body.generationConfig.responseJsonSchema, schema);
      }
    } finally {
      registry.close();
    }
  });
}
test('malformed/schema-invalid/incomplete JSON output rejects; streaming retains inert text and cleanup', async () => {
  /** Explicit native JSON request with a trusted local validator, not a prompt-only constraint. */
  const output = {
    type: 'json',
    schema: { type: 'object', properties: { value: { type: 'string' } } },
    validator: object({ value: string() }),
  };
  // Cross malformed/schema-invalid text with unsuccessful finish reasons.
  for (const [text, reason] of [
    ['not json', 'STOP'],
    ['{"value":12}', 'STOP'],
    ['{"value":"x"}', 'MAX_TOKENS'],
  ]) {
    /** Synthetic provider fixture; injected methods/transport avoid live model calls. */
    const p = createGeminiProvider({
      apiKey: 'x',
      model: 'fixture',
      fetch: async () =>
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text }] }, finishReason: reason },
            ],
          })
        ),
    });
    await assert.rejects(
      p.chatContent([{ role: 'user', content: 'x' }], { output }),
      /JSON/
    );
  }
  let cancelled = false;
  /** Synthetic provider fixture; injected methods/transport avoid live model calls. */
  const p = createGeminiProvider({
    apiKey: 'x',
    model: 'fixture',
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(c) {
            /** One controlled SSE data frame used to test parser boundaries and cleanup. */
            const frame =
              'data: ' +
              JSON.stringify({
                candidates: [
                  {
                    content: {
                      parts: [
                        {
                          text: '<script>globalThis.__aiExecuted=true</script>🌟',
                        },
                      ],
                    },
                    finishReason: 'STOP',
                  },
                ],
              }) +
              '\n\n';
            /** Encoded synthetic response bytes, never an actual downloaded media file. */
            const data = new TextEncoder().encode(frame);
            for (let i = 0; i < data.length; i += 2) {
              c.enqueue(data.slice(i, i + 2));
            }
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      ),
  });
  let text = '';
  // Collect partial text as inert events; streaming never claims complete JSON validation.
  for await (const event of p.streamContent([
    {
      role: 'user',
      content: [{ type: 'image', mimeType: 'image/png', data: bytes }],
    },
  ])) {
    if (event.type === 'text') {
      text += event.text;
      break;
    }
  }
  assert.match(text, /script/);
  assert.equal(globalThis.__aiExecuted, undefined);
  assert.equal(cancelled, true);
  await assert.rejects(async () => {
    // Consume the negative stream so validation/cancellation failures reach the assertion.
    for await (const _ of p.streamContent([{ role: 'user', content: 'x' }], {
      output,
    })) {
      /* Drain or observe the deliberately failing fixture; the enclosing assertion checks its outcome. */
    }
  }, /Buffered/);
});
test('aggregate base64 budgets, JSON references and prototype-like data remain bounded/inert', async () => {
  let calls = 0;
  /** Private synthetic configuration; dummy credentials never authorize an external service. */
  const config = {
    apiKey: 'x',
    model: 'fixture',
    fetch: async () => {
      calls++;
      return new Response(JSON.stringify(nativeResponse('gemini')));
    },
  };
  /** Tiny aggregate request ceiling tests base64/envelope overhead before dispatch. */
  const tiny = createGeminiProvider({ ...config, maxRequestBytes: 100 });
  await assert.rejects(
    tiny.chatContent([
      {
        role: 'user',
        content: [
          { type: 'video', mimeType: 'video/mp4', data: new Uint8Array(100) },
        ],
      },
    ]),
    /budget|size/
  );
  assert.equal(calls, 0);
  /** Prototype-like keys and command text are JSON data, not object mutation or execution. */
  const jsonValue = JSON.parse(
    '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"command":"rm -rf /"}'
  );
  /** Synthetic provider fixture; injected methods/transport avoid live model calls. */
  const p = createGeminiProvider(config);
  await p.chatContent([
    { role: 'user', content: [{ type: 'json', value: jsonValue }] },
  ]);
  assert.equal({}.polluted, undefined);
  await assert.rejects(
    p.chatContent([{ role: 'user', content: 'x' }], {
      output: {
        type: 'json',
        schema: { $ref: 'https://attacker.test/schema' },
        validator: object({}),
      },
    }),
    /reference/
  );
  assert.equal(calls, 1);
  let touched = false;
  /** Single-byte opaque input exercises type/prototype checks, not file-format validation. */
  const binary = new Uint8Array([1]);
  Object.defineProperty(binary, 'byteLength', {
    get() {
      touched = true;
      throw Error('must not execute');
    },
  });
  await p.chatContent([
    {
      role: 'user',
      content: [{ type: 'image', mimeType: 'image/png', data: binary }],
    },
  ]);
  assert.equal(touched, false);
});
