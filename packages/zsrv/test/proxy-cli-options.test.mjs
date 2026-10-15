import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProxyStartArguments } from '../dist/bin/parse-proxy.js';
test('proxy flags validate loopback binding, limits, and duplicates', () => {
 assert.deepEqual(parseProxyStartArguments(['--https','--port','443','--bind','localhost','--rate','10','--burst','20','--max-active','30','--max-body','8192']),{
  port:443,https:true,bindHost:'127.0.0.1',limits:{ratePerSecond:10,burst:20,maxActiveRequests:30,maxBodyBytes:8192}});
 for (const args of [['--port','443foo'],['--bind','example.org'],['--rate','-1'],['--rate','2','--rate','3'],['--burst','8'],['--max-body','99999999999999999999999'],['--broken']]) {
  assert.throws(()=>parseProxyStartArguments(args),undefined,JSON.stringify(args));
 }
});
test('proxy cache CLI flags are explicit, bounded and opt-in', () => {
  const parsed = parseProxyStartArguments(['--cache', '--cache-max-entries','20','--cache-max-entry-bytes','1000','--cache-max-total-bytes','5000','--cache-max-age','90']);
  assert.deepEqual(parsed.cache, { enabled:true, maxEntries:20, maxEntryBytes:1000, maxTotalBytes:5000, maxAgeSeconds:90 });
  assert.equal(parseProxyStartArguments(['--no-cache']).cache.enabled, false);
  assert.throws(() => parseProxyStartArguments(['--cache','--cache-max-total-bytes','1']), RangeError);
  assert.throws(() => parseProxyStartArguments(['--cache','--cache-max-age','90000']), RangeError);
  assert.throws(() => parseProxyStartArguments(['--cache','--cache']), /Repeated/);
});
