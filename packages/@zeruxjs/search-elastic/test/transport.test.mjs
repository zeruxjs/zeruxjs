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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zx057-tls-'));
  let server, adapter; const sockets = new Set(); let credentials, redirect = false, requests = 0;
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
    const cert = await fs.readFile(path.join(dir, 'cert.pem'), 'utf8');
    server = https.createServer({ cert, key: await fs.readFile(path.join(dir, 'key.pem')) }, (req, res) => {
      requests++; credentials = req.headers.authorization;
      if (redirect) { res.writeHead(302, { location: 'https://unapproved.example/' }); res.end(); return; }
      res.writeHead(200, { 'content-type': 'application/json', 'x-elastic-product': 'Elasticsearch' }); res.end(JSON.stringify({ version: { number: '9.5.1' } }));
    });
    server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const endpoint = `https://127.0.0.1:${server.address().port}`;
    const config = { index: 'fixture-v1', endpoint, allowedEndpoints: [endpoint], auth: { apiKey: 'fixture-key' }, ca: cert, timeoutMs: 500 };
    await assert.rejects(createElasticSearchAdapter({ ...config, ca: undefined }), { code: 'UNAVAILABLE' });
    const basic = await createElasticSearchAdapter({ ...config, auth: { username: 'fixture-user', password: 'fixture-password' } });
    assert.equal(credentials, 'Basic ' + Buffer.from('fixture-user:fixture-password').toString('base64'));
    await basic.close();
    adapter = await createElasticSearchAdapter(config);
    assert.equal(credentials, 'ApiKey fixture-key');
    assert.equal(await adapter.health({ signal: new AbortController().signal, deadline: Date.now() + 1000 }), 'ready');
    redirect = true; const prior = requests;
    await assert.rejects(adapter.health({ signal: new AbortController().signal, deadline: Date.now() + 1000 }), error => ['UNAVAILABLE', 'UNSUPPORTED'].includes(error.code));
    assert.equal(requests, prior + 1);
    await adapter.close(); adapter = undefined;
    await new Promise(r => setTimeout(r, 20)); assert.equal(sockets.size, 0);
  } finally {
    await adapter?.close(); for (const socket of sockets) socket.destroy();
    if (server?.listening) await new Promise(r => server.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
