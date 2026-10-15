import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthority, readHopCount, createForwardedHeaders, matchProxyRoute } from '../dist/portless/request-security.js';
test('authority parsing rejects unsafe strings and handles IPv6', () => {
  assert.equal(parseAuthority('app.localhost:4000')?.hostname, 'app.localhost');
  assert.equal(parseAuthority('[::1]:8080')?.port, 8080);
  for (const value of ['user@localhost', 'example.com/path', 'bad host', 'example.com:99999', '']) assert.equal(parseAuthority(value), null);
});
test('forwarding metadata is based on verified socket and authority', () => {
  assert.deepEqual(createForwardedHeaders('app.localhost:3000', '127.0.0.2', true), {
    'x-forwarded-for': '127.0.0.2', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'app.localhost:3000', 'x-forwarded-port': '3000'
  });
});
test('hop count cannot be smuggled and routes prefer exact/longest match', () => {
  for (const value of ['-1','NaN','0garbage','1, 2', ['1','2']]) assert.equal(readHopCount(value), null);
  assert.equal(readHopCount(undefined), 0);
  const routes = [{hostname:'localhost', port:1},{hostname:'app.localhost', port:2}];
  assert.equal(matchProxyRoute(routes, 'foo.app.localhost')?.port, 2);
  assert.equal(matchProxyRoute(routes, 'notlocalhost'), undefined);
});
