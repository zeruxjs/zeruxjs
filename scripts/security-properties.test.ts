import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  escapeHtmlText,
  escapeHtmlAttribute,
  serializeJsonForScript,
  serializeJavaScriptValue,
  validateNavigationUrl,
} from '@zeruxjs/security/encoding';

/** Reproducible generated inputs; an interrupted run fails instead of reporting incomplete coverage as success. */
const limits = {
  seed: 0x5eed,
  numRuns: 1000,
  interruptAfterTimeLimit: 10_000,
  markInterruptAsFailure: true,
};

/** Convert bounded UTF-16 units, including lone surrogates, without executing generated input.
 * @param {number[]} units - At most 256 generated UTF-16 code units.
 * @returns {string} Literal synthetic text; no source file or environment data is read.
 */
function fromUnits(units: number[]): string {
  return String.fromCharCode(...units);
}

/** Bounded arbitrary UTF-16 text exercises controls, delimiters and malformed surrogate sequences. */
const text = fc
  .array(fc.integer({ min: 0, max: 65535 }), { maxLength: 256 })
  .map(fromUnits);

/** Decode only the five named forms promised by the HTML-text encoder, in one pass.
 * @param {string} encoded - Encoder output; decoding is a test oracle, not a production HTML parser.
 * @returns {string} Literal original text, with no DOM construction or evaluation.
 */
function decodeText(encoded: string): string {
  /** Fixed entity meanings; decoding once preserves already-authored entity spellings. */
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
  };
  return encoded.replace(
    /&(?:amp|lt|gt|quot|#39);/g,
    (entity) => entities[entity] ?? entity
  );
}

test(
  'generated HTML text round-trips and quoted attributes contain no raw delimiters or controls',
  { timeout: 15_000 },
  () => {
    fc.assert(
      fc.property(text, (value) => {
        /** Text-context encoding must preserve the original UTF-16 sequence. */
        const encoded = escapeHtmlText(value);
        assert.doesNotMatch(encoded, /[<>"']/);
        assert.equal(decodeText(encoded), value);
        /** Attribute encoding additionally removes raw controls and backticks. */
        const attribute = escapeHtmlAttribute(value);
        assert.doesNotMatch(attribute, /[<>"'`]/);
        // Inspect code units without a control-character regular expression or HTML execution.
        for (const character of attribute) {
          /** Attribute output code point used only for the forbidden-control invariant. */
          const unit = character.charCodeAt(0);
          assert.ok(unit > 31 && unit !== 127);
        }
      }),
      limits
    );
  }
);

test(
  'generated JSON preserves own keys without executable script delimiters',
  { timeout: 15_000 },
  () => {
    fc.assert(
      fc.property(text, fc.array(text, { maxLength: 8 }), (value, values) => {
        /** Computed prototype spelling is an own data property, never an object-literal prototype setter. */
        const original = { value, values, ['__proto__']: { value } };
        /** Script-safe JSON is parsed as data; no generated expression is evaluated. */
        const json = serializeJsonForScript(original);
        assert.deepEqual(JSON.parse(json), original);
        assert.doesNotMatch(json, /[<>&\u2028\u2029]/);
        /** The public expression wraps a JSON string literal; independently parse both layers as inert data. */
        const expression = serializeJavaScriptValue(original);
        assert.ok(
          expression.startsWith('JSON.parse(') && expression.endsWith(')')
        );
        assert.deepEqual(
          JSON.parse(JSON.parse(expression.slice(11, -1))),
          original
        );
        assert.doesNotMatch(expression, /[<>&\u2028\u2029]/);
      }),
      {
        ...limits,
        examples: [
          ['</script><script>never()</script>', ['\u2028', '\u2029', '&']],
        ],
      }
    );
  }
);

test(
  'generated navigation paths retain the exact approved origin',
  { timeout: 15_000 },
  () => {
    fc.assert(
      fc.property(text, (value) => {
        /** Encode synthetic path data before applying the public navigation policy. */
        const path = '/' + new URLSearchParams({ value }).toString();
        assert.equal(
          validateNavigationUrl(path, {
            baseUrl: 'https://safe.example/base/',
            allowedOrigins: ['https://safe.example'],
          }),
          new URL(path, 'https://safe.example').href
        );
      }),
      limits
    );
  }
);

test(
  'generated unsafe schemes and foreign origins remain denied',
  { timeout: 15_000 },
  () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'javascript:',
          'data:text/plain,',
          'file:///',
          '//evil.example/',
          'https://evil.example/'
        ),
        text,
        (prefix, value) => {
          assert.throws(
            () =>
              validateNavigationUrl(
                prefix + new URLSearchParams({ value }).toString(),
                {
                  baseUrl: 'https://safe.example',
                  allowedOrigins: ['https://safe.example'],
                }
              ),
            TypeError
          );
        }
      ),
      limits
    );
  }
);
