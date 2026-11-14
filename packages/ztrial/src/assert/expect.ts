import { deepEqual } from '../utils/merge.js';
/** Format trusted assertion values for in-process failure messages; this is not a public secret-redacting serializer.
 * @param {unknown} x - Trusted test value; JSON/string conversion may invoke its own hooks.
 * @returns {string} Diagnostic representation; public exporters omit errors by default.
 */
function format(x: unknown) {
  try {
    return JSON.stringify(x) ?? String(x);
  } catch {
    return String(x);
  }
}
/** Throw a descriptive trusted assertion failure only when the evaluated predicate is false.
 * @param {boolean} ok - Already evaluated assertion predicate.
 * @param {string} description - Host/test-authored private diagnostic text.
 * @returns {void} Passes silently or throws a trusted assertion failure whose value text may be private.
 */
function assertion(ok: boolean, description: string) {
  if (!ok) {
    throw new Error(description);
  }
}
type Thunk = () => unknown;
/** Walk dotted property names on trusted test values using existing inherited-property semantics; getters may execute.
 * @param {unknown} value - Trusted assertion object, never hostile executable metadata.
 * @param {string} key - Dotted property lookup label.
 * @returns {boolean} Whether each dotted segment is present; this is not own-field schema validation.
 */
function hasProperty(value: unknown, key: string): boolean {
  return key.split('.').every((part, _i, _all) => {
    if (
      !value ||
      (typeof value !== 'object' && typeof value !== 'function') ||
      !(part in value)
    ) {
      return false;
    }
    value = (value as Record<string, unknown>)[part];
    return true;
  });
}
/** Create synchronous/promise assertion helpers over a trusted value without executing it until a selected assertion requires it.
 * @param {T} value - Trusted test assertion value; never use private values in publicly disclosed errors.
 * @returns {object} Positive assertions plus a separate negated view; this is a focused matcher subset.
 */
export function expect<T>(value: T) {
  /** Create a positive or negated matcher view over this same borrowed trusted assertion value.
   * @param {boolean} negate Whether to invert each evaluated matcher predicate.
   * @returns {object} Trusted matcher methods with no automatic execution. */
  const create = (negate: boolean) => {
    /** Apply matcher negation and construct a private value-bearing assertion diagnostic.
     * @param {boolean} ok Already evaluated supported matcher predicate.
     * @param {string} label Fixed matcher explanation plus trusted expected-value diagnostics.
     * @returns {void} Passes or throws; default report policies must prevent private diagnostic disclosure. */
    const check = (ok: boolean, label: string) =>
      assertion(
        negate ? !ok : ok,
        `Expected ${format(value)} ${negate ? 'not ' : ''}${label}`
      );
    /** Per-view explicit supported matcher implementations; no dynamic method/source loading. */
    const api = {
      /** Compare trusted values with Object.is identity semantics.
       * @param {unknown} expected - Trusted expected value or numeric bound for this matcher.
       * @returns {void} Passes silently or throws a trusted assertion failure whose value text may be private.
       */
      toBe(expected: unknown) {
        check(Object.is(value, expected), `to be ${format(expected)}`);
      },
      /** Compare supported trusted native values with cycle-aware deep equality.
       * @param {unknown} expected - Trusted expected value or numeric bound for this matcher.
       * @returns {void} Passes silently or throws a trusted assertion failure whose value text may be private.
       */
      toEqual(expected: unknown) {
        check(deepEqual(value, expected), `to equal ${format(expected)}`);
      },
      /** Check trusted value Boolean coercion for truthiness.
       * @returns {void} Passes silently or throws a trusted assertion failure whose value text may be private.
       */
      toBeTruthy() {
        check(Boolean(value), 'to be truthy');
      },
      /** Check trusted value Boolean coercion for falsiness.
       * @returns {void} Passes silently or throws a trusted assertion failure whose value text may be private.
       */
      toBeFalsy() {
        check(!value, 'to be falsy');
      },
      /** Require the exact null value.
       * @returns {void} Passes silently or throws a trusted assertion failure whose value text may be private.
       */
      toBeNull() {
        check(value === null, 'to be null');
      },
      /** Require the exact undefined value.
       * @returns {void} Passes silently or throws a trusted assertion failure whose value text may be private.
       */
      toBeUndefined() {
        check(value === undefined, 'to be undefined');
      },
      /** Check string, array or Set membership using the documented native/deep comparison semantics.
       * @param {unknown} expected - Trusted expected value or numeric bound for this matcher.
       * @returns {void} Passes silently or throws a trusted assertion failure whose value text may be private.
       */
      toContain(expected: unknown) {
        let contained: boolean;
        if (typeof value === 'string') {
          contained = value.includes(String(expected));
        } else if (Array.isArray(value)) {
          contained = value.some((v) => deepEqual(v, expected));
        } else if (value instanceof Set) {
          contained = value.has(expected);
        } else {
          contained = false;
        }
        check(contained, `to contain ${format(expected)}`);
      },
      /** Match trusted text against literal substring or an explicitly compiled host RegExp; this does not compile untrusted pattern strings.
       * @param {string | RegExp} pattern - Trusted literal substring or precompiled RegExp; native RegExp state semantics are preserved.
       * @returns {void} Passes silently or throws a trusted assertion failure whose value text may be private.
       */
      toMatch(pattern: string | RegExp) {
        check(
          typeof value === 'string' &&
            (typeof pattern === 'string'
              ? value.includes(pattern)
              : pattern.test(value)),
          `to match ${String(pattern)}`
        );
      },
      /** Require a trusted length-bearing value to report the exact expected number.
       * @param {number} length - Trusted expected native length.
       * @returns {void} Passes silently or throws a trusted assertion failure whose value text may be private.
       */
      toHaveLength(length: number) {
        check(
          value !== null &&
            typeof value !== 'undefined' &&
            typeof (value as { length?: number }).length === 'number' &&
            (value as unknown as { length: number }).length === length,
          `to have length ${length}`
        );
      },
      /** Check dotted inherited property presence on trusted values; it is not authorization or schema validation.
       * @param {string} key - Trusted dotted property label.
       * @returns {void} Passes silently or throws a trusted assertion failure whose value text may be private.
       */
      toHaveProperty(key: string) {
        check(hasProperty(value, key), `to have property ${key}`);
      },
      /** Require a numeric trusted value strictly greater than the supplied bound.
       * @param {number} expected - Trusted expected value or numeric bound for this matcher.
       * @returns {void} Passes silently or throws a trusted assertion failure whose value text may be private.
       */
      toBeGreaterThan(expected: number) {
        check(
          typeof value === 'number' && value > expected,
          `to be greater than ${expected}`
        );
      },
      /** Require a numeric trusted value strictly less than the supplied bound.
       * @param {number} expected - Trusted expected value or numeric bound for this matcher.
       * @returns {void} Passes silently or throws a trusted assertion failure whose value text may be private.
       */
      toBeLessThan(expected: number) {
        check(
          typeof value === 'number' && value < expected,
          `to be less than ${expected}`
        );
      },
      /** Require trusted native prototype-instance semantics for the supplied constructor.
       * @param {new (...args: never[]) => unknown} type - Trusted constructor; custom Symbol.hasInstance may execute its own logic.
       * @returns {void} Passes silently or throws a trusted assertion failure whose value text may be private.
       */
      toBeInstanceOf(type: new (...args: never[]) => unknown) {
        check(value instanceof type, `to be instance of ${type.name}`);
      },
      /** Execute the trusted synchronous function once and require a caught non-undefined failure with an optional message match.
       * @param {string | RegExp} message - Optional trusted substring or compiled RegExp applied to the private failure string.
       * @returns {void} Passes silently or throws a trusted assertion failure whose value text may be private.
       */
      toThrow(message?: string | RegExp) {
        let error: unknown;
        if (typeof value !== 'function') {
          throw new TypeError('Expected function');
        }
        try {
          (value as Thunk)();
        } catch (e) {
          error = e;
        }
        check(
          error !== undefined &&
            (message === undefined ||
              (typeof message === 'string'
                ? String(error).includes(message)
                : message.test(String(error)))),
          `to throw ${String(message ?? '')}`
        );
      },
      /** Await the trusted promise or invoke its function once and require rejection; no callback side effect is replayed.
       * @param {string | RegExp} message - Optional trusted substring or compiled RegExp applied to the private rejection string.
       * @returns {Promise<void>} Actual rejection assertion outcome; noncooperative promises have no matcher-owned timeout.
       */
      async toReject(message?: string | RegExp) {
        let error: unknown;
        try {
          await (typeof value === 'function' ? (value as Thunk)() : value);
        } catch (e) {
          error = e;
        }
        check(
          error !== undefined &&
            (message === undefined ||
              (typeof message === 'string'
                ? String(error).includes(message)
                : message.test(String(error)))),
          `to reject ${String(message ?? '')}`
        );
      },
      /** Await the trusted promise or invoke its function once and require fulfillment.
       * @returns {Promise<void>} Actual fulfillment assertion outcome; matcher has no independent forced-cancellation mechanism.
       */
      async toResolve() {
        let ok = true;
        try {
          await (typeof value === 'function' ? (value as Thunk)() : value);
        } catch {
          ok = false;
        }
        check(ok, 'to resolve');
      },
    };
    return api;
  };
  return { ...create(false), not: create(true) };
}
