/** Describe private input as a literal/type name without JSON serialization; constructor metadata and proxies remain trusted runtime behavior.
 * @param {unknown} input - Private rejected value; strings are deliberately not escaped or truncated here.
 * @returns {string} Private unescaped diagnostic text, never safe HTML or a redacted audit value.
 * @internal
 */
// @__NO_SIDE_EFFECTS__
export function _stringify(input: unknown): string {
  /** Native typeof discriminator; object constructor-name lookup is handled separately. */
  const type = typeof input;
  if (type === 'string') {
    return `"${input}"`;
  }
  // TODO: Should we add "n" suffix to bigints?
  if (type === 'number' || type === 'bigint' || type === 'boolean') {
    return `${input}`;
  }
  if (type === 'object' || type === 'function') {
    return (input && Object.getPrototypeOf(input)?.constructor?.name) ?? 'null';
  }
  return type;
}
