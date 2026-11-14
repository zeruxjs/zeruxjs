import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import * as React from 'react';
import { createApplicationLifecycle } from 'zeruxjs';
import { createReactRenderer } from 'zeruxjs/renderers';
import { createReactBindings } from '../dist/index.js';
import { renderReactToString } from '../dist/server.js';
import { createReactHydrationState } from '../dist/hydration.mjs';
/** Stateless actual/injected React hook bindings; per-user stores remain request-owned. */
const bindings = createReactBindings(React);
test('framework registry uses real React SSR with isolated request snapshots', async (t) => {
  /** Owned temporary fixture root; it is removed even after test failure. */
  const root = await mkdtemp(join(tmpdir(), 'react-framework-'));
  let app, server;
  try {
    app = await createApplicationLifecycle({
      rootDir: root,
      config: {},
      providers: { database: async () => null, cache: async () => null },
    });
    /** Borrowed plugin API from the isolated framework lifecycle. */
    const api = app.runtime().asPluginApi();
    /** Explicit renderer registration token; no default renderer is selected. */
    const token = api
      .renderers()
      .register(createReactRenderer(renderReactToString));
    /** Render a synthetic borrowed store through actual native hooks using the declared SSR snapshot.
     * @param {object} props - Explicit trusted fixture props.
     * @param {object} props.store - Borrowed request/fixture store.
     * @returns {object} Explicit synthetic fixture result or intentional failure.
     */
    function View({ store }) {
      return React.createElement('p', null, bindings.useStore(store).label);
    }
    api.addRoute({
      pattern: '/react',
      handler: async (context) => {
        /** Owned synthetic public state disposed per request/test; never a module singleton. */
        const state = createReactHydrationState(
          { label: context.query.get('name') },
          {
            identifierPrefix: 'request',
            validateState: (value) => {
              if (typeof value.label !== 'string') {
                throw Error('invalid');
              }
              return { label: value.label };
            },
          }
        );
        // Register idempotent fixture ownership before subsequent assertions can fail.
        t.after(() => {
          state.dispose();
        });
        try {
          return await context.render(
            token,
            React.createElement(View, { store: state.store })
          );
        } finally {
          state.dispose();
        }
      },
    });
    server = createServer(
      (req, res) => void app.handle(req, res).catch(() => res.destroy())
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    /** Bounded isolated request outputs, not a load benchmark. */
    const results = await Promise.all(
      ['one', 'two'].map(async (name) =>
        (
          await fetch(
            `http://127.0.0.1:${server.address().port}/react?name=${name}`
          )
        ).text()
      )
    );
    assert.deepEqual(results, ['<p>one</p>', '<p>two</p>']);
  } finally {
    try {
      await app?.close();
    } finally {
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      await rm(root, { recursive: true, force: true });
    }
  }
});
