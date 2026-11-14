import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectInboundSafety, type InboundSafetyFlag } from '../dist/index.js';
test(
  'mail markup heuristics bound malformed tags and keep content inert',
  { timeout: 1000 },
  () => {
    // Exercise the finite hostile-markup/expected-flag cases without parsing a DOM or executing content.
    for (const html of [
      'src=' + '\t'.repeat(100000),
      '<a ' + ' '.repeat(100000),
      '<'.repeat(100000),
    ]) {
      assert.doesNotThrow(() =>
        inspectInboundSafety({ html, from: ['sender@example.test'] })
      );
    }
    /** Pure lexical safety result; flags are advisory and no HTML/script/remote URL is executed. */
    const value = inspectInboundSafety({
      from: ['sender@example.test'],
      html: '<A HREF="https://attacker.test">https://bank.test</A><IMG SRC="https://remote.test/image"><iframe onload="never()" src="javascript:never()"></iframe>',
    });
    // Exercise the finite hostile-markup/expected-flag cases without parsing a DOM or executing content.
    for (const flag of [
      'suspicious_link',
      'remote_content',
      'active_html',
      'unsafe_url',
    ] as InboundSafetyFlag[]) {
      assert.ok(value.flags.includes(flag), flag);
    }
    assert.ok(
      inspectInboundSafety({
        html: '<<SCRIPT>never()</SCRIPT>',
      }).flags.includes('active_html')
    );
    assert.ok(
      inspectInboundSafety({
        html: 'x'.repeat(1024 * 1024 + 1),
      }).flags.includes('body_truncated')
    );
  }
);
