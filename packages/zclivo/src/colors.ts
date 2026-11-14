/** ANSI colors without external dependencies. Honors NO_COLOR and non-TTY output. */
type Color = ((value: unknown) => string) & {
  bold: Color;
  yellow: Color;
  green: Color;
  red: Color;
  cyan: Color;
  blue: Color;
  dim: Color;
};
/** Check current terminal preferences without allocating global output listeners.
 * @returns {boolean} Whether explicit color output is enabled for this process.
 */
function enabled() {
  return (
    !process.env.NO_COLOR &&
    (Boolean(process.env.FORCE_COLOR) || Boolean(process.stdout.isTTY))
  );
}
/** Create a stateless callable ANSI style with lazily composed style properties.
 * @param {string} code - Trusted internal ANSI numeric sequence, never an untrusted option value.
 * @returns {Color} Callable style wrapper; input strings remain caller-owned and unsanitized.
 */
function format(code: string) {
  /** Lazy callable style wrapper; application values are stringified but not terminal-sanitized here.
   * @param {unknown} value - Application-owned value, converted using native String semantics.
   * @returns {string} Styled text when enabled, otherwise the unstyled string.
   */
  const call = ((value: unknown) =>
    enabled()
      ? `\x1b[${code}m${String(value)}\x1b[0m`
      : String(value)) as Color;
  Object.defineProperties(call, {
    bold: { get: () => format(code === '0' ? '1' : `1;${code}`) },
    yellow: { get: () => format(`33;${code}`) },
    green: { get: () => format(`32;${code}`) },
    red: { get: () => format(`31;${code}`) },
    cyan: { get: () => format(`36;${code}`) },
    blue: { get: () => format(`34;${code}`) },
    dim: { get: () => format(`2;${code}`) },
  });
  return call;
}
/** Shared stateless style factory; terminal enablement is checked on each call. */
export const color = format('0');
