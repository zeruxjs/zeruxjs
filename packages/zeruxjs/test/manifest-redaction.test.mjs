import test from 'node:test';
import assert from 'node:assert/strict';
import { redactManifestConfig } from '../dist/bootstrap/manifest-config.js';

test('manifests never serialize nested connection secrets while keeping nonsecret structure', () => {
  /** Synthetic private configuration exercising nested and circular manifest redaction. */
  const config = {
    server: { port: 3000 },
    apiKeys: { lighthouse: 'private' },
    security: { keys: { session: 'secret' } },
    auth: {
      sso: {
        google: { clientSecret: 'top-secret', clientId: 'public-client' },
      },
    },
    environment: [
      {
        connectionString: 'postgres://user:pass@host',
        token: 'bearer',
        hostname: 'host',
      },
    ],
    cache: { prefix: 'public' },
  };
  /** Original serialized configuration proving redaction does not mutate host input. */
  const original = JSON.stringify(config);
  /** Redacted manifest projection inspected without exposing the private input. */
  const result = redactManifestConfig(config);
  /** Public manifest text checked against known synthetic secrets and key identifiers. */
  const serialized = JSON.stringify(result);
  for (const secret of [
    'top-secret',
    'private',
    'postgres://user:pass@host',
    'bearer',
    'secret',
  ]) {
    assert.ok(!serialized.includes(secret), secret);
  }
  assert.equal(result.server.port, 3000);
  assert.equal(JSON.stringify(config), original);
});

test('manifest redaction does not enter infinite loops on arbitrary plugin config', () => {
  /** Synthetic private configuration exercising nested and circular manifest redaction. */
  const config = { value: 1 };
  config.loop = config;
  /** Redacted manifest projection inspected without exposing the private input. */
  const result = redactManifestConfig(config);
  assert.match(result.loop, /REDACTED:circular/);
});

test('key ring secrets never appear in runtime manifest while public IDs remain readable', () => {
  /** Synthetic private configuration exercising nested and circular manifest redaction. */
  const config = {
    email: {
      tracking: {
        baseUrl: 'https://events.example.com',
        keyRing: {
          current: { id: 'nov', secret: 'TOP-SECRET-NOV-ROTATION-KEY' },
          previous: [{ id: 'oct', secret: 'TOP-SECRET-OCT-ROTATION-KEY' }],
        },
      },
    },
  };
  /** Public manifest text checked against known synthetic secrets and key identifiers. */
  const serialized = JSON.stringify(redactManifestConfig(config));
  assert.ok(!serialized.includes('TOP-SECRET-NOV'));
  assert.ok(!serialized.includes('TOP-SECRET-OCT'));
  assert.ok(serialized.includes('nov'));
  assert.ok(serialized.includes('oct'));
});
