import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createElasticSearchAdapter } from '@zeruxjs/search-elastic';

test('official client uses authenticated verified TLS, rejects redirects, and drains owned sockets', async () => {
  /** Owned temporary certificate directory; remove recursively in teardown. */
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zx057-tls-'));
  let server, adapter;
  /** Owned local HTTPS fixture sockets; destroy them before closing the listener. */
  const sockets = new Set();
  let credentials,
    redirect = false,
    requests = 0;
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        path.join(dir, 'key.pem'),
        '-out',
        path.join(dir, 'cert.pem'),
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      { stdio: 'ignore' }
    );
    /** Disposable self-signed localhost test certificate; no production trust settings are changed. */
    const cert = await fs.readFile(path.join(dir, 'cert.pem'), 'utf8');
    server = https.createServer(
      { cert, key: await fs.readFile(path.join(dir, 'key.pem')) },
      (req, res) => {
        requests++;
        credentials = req.headers.authorization;
        if (redirect) {
          res.writeHead(302, { location: 'https://unapproved.example/' });
          res.end();
          return;
        }
        res.writeHead(200, {
          'content-type': 'application/json',
          'x-elastic-product': 'Elasticsearch',
        });
        res.end(JSON.stringify({ version: { number: '9.5.1' } }));
      }
    );
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    /** Explicit owned local HTTPS fixture or opt-in isolated live-engine endpoint. */
    const endpoint = `https://127.0.0.1:${server.address().port}`;
    /** Explicit local HTTPS fixture policy with fixed synthetic credentials. */
    const config = {
      index: 'fixture-v1',
      endpoint,
      allowedEndpoints: [endpoint],
      auth: { apiKey: 'fixture-key' },
      ca: cert,
      timeoutMs: 500,
    };
    await assert.rejects(
      createElasticSearchAdapter({ ...config, ca: undefined }),
      { code: 'UNAVAILABLE' }
    );
    /** Owned basic-auth adapter fixture; close it even if an authentication assertion fails. */
    const basic = await createElasticSearchAdapter({
      ...config,
      auth: { username: 'fixture-user', password: 'fixture-password' },
    });
    try {
      assert.equal(
        credentials,
        'Basic ' +
          Buffer.from('fixture-user:fixture-password').toString('base64')
      );
    } finally {
      await basic.close();
    }
    adapter = await createElasticSearchAdapter(config);
    assert.equal(credentials, 'ApiKey fixture-key');
    assert.equal(
      await adapter.health({
        signal: new AbortController().signal,
        deadline: Date.now() + 1000,
      }),
      'ready'
    );
    redirect = true;
    /** Previous synthetic request count or native version used for exact replay/CAS checks. */
    const prior = requests;
    await assert.rejects(
      adapter.health({
        signal: new AbortController().signal,
        deadline: Date.now() + 1000,
      }),
      (error) => ['UNAVAILABLE', 'UNSUPPORTED'].includes(error.code)
    );
    assert.equal(requests, prior + 1);
    await adapter.close();
    adapter = undefined;
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(sockets.size, 0);
  } finally {
    try {
      await adapter?.close();
    } finally {
      for (const socket of sockets) {
        socket.destroy();
      }
      try {
        if (server?.listening) {
          await new Promise((r) => server.close(r));
        }
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  }
});
