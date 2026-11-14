/** Validate the implemented shallow MCP object-schema subset without evaluating schema text or loading a schema provider.
 * @param {Record<string,unknown>|undefined} schema - Trusted optional object schema using type, required, properties and additionalProperties false.
 * @param {Record<string,unknown>} args - Inert argument record already checked by the registry; validation never grants execution permission.
 * @returns {void} Throws for the implemented violations; nested schemas, refs, formats, enums and numeric/string bounds are not enforced.
 */
export function validateArguments(
  schema: Record<string, unknown> | undefined,
  args: Record<string, unknown>
): void {
  if (!schema) {
    return;
  }
  if (schema.type && schema.type !== 'object') {
    throw new TypeError('Tool schema must describe an object');
  }
  /** Optional declared required-name list; only string names participate in the existing own-field check. */
  const required = schema.required;
  if (Array.isArray(required)) {
    for (const name of required) {
      if (typeof name === 'string' && !Object.hasOwn(args, name)) {
        throw new TypeError(`Missing argument: ${name}`);
      }
    }
  }
  /** Trusted shallow property rules; no nested schema is executed or resolved. */
  const properties = schema.properties;
  if (properties && typeof properties === 'object') {
    for (const [key, rule] of Object.entries(properties)) {
      if (!Object.hasOwn(args, key) || !rule || typeof rule !== 'object') {
        continue;
      }
      /** Own argument value inspected only against the supported primitive/container type. */
      const value = args[key];
      /** Declared supported property type; unimplemented keywords remain outside this subset. */
      const type = (rule as Record<string, unknown>).type;
      if (
        (type === 'string' && typeof value !== 'string') ||
        (type === 'number' &&
          (typeof value !== 'number' || !Number.isFinite(value))) ||
        (type === 'integer' && !Number.isInteger(value)) ||
        (type === 'boolean' && typeof value !== 'boolean') ||
        (type === 'array' && !Array.isArray(value)) ||
        (type === 'object' &&
          (value === null || typeof value !== 'object' || Array.isArray(value)))
      ) {
        throw new TypeError(`Invalid argument: ${key}`);
      }
    }
  }
  if (schema.additionalProperties === false) {
    /** Explicit allowed property names used only when additionalProperties is false. */
    const keys = new Set(Object.keys((properties ?? {}) as object));
    for (const key of Object.keys(args)) {
      if (!keys.has(key)) {
        throw new TypeError(`Unexpected argument: ${key}`);
      }
    }
  }
}
