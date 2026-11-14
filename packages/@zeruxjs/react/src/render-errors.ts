/** Fixed public messages; native module/render causes remain available only to the trusted host. */
export class ReactAdapterError extends Error {
  /** Create a fixed-code public adapter error; original causes stay private, never automatically logged.
   * @param {string} code - Fixed public diagnostic code; never interpolate private native messages.
   * @param {unknown} cause - Optional native cause retained only for trusted host diagnostics.
   */
  constructor(
    readonly code: string,
    cause?: unknown
  ) {
    super(`React adapter: ${code}`, { cause });
    this.name = 'ReactAdapterError';
  }
}
/** Validate the optional signal and reject already aborted work. Same-thread checks cannot interrupt native synchronous component rendering.
 * @param {AbortSignal} signal - Optional host AbortSignal; checks cannot preempt synchronous JavaScript.
 * @returns {void} Explicit checked native result; private causes remain host-only and failed work is not replayed.
 */
export function checkReactAbort(signal?: AbortSignal): void {
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new ReactAdapterError('INVALID_SIGNAL');
  }
  if (signal?.aborted) {
    throw new ReactAdapterError('RENDER_ABORTED', signal.reason);
  }
}
/** Require a bounded HTML-safe prefix, optionally nonempty; it is an identifier, never authorization.
 * @param {unknown} value - Unknown prefix/byte policy value validated before rendering.
 * @param {boolean} required - Default false; true requires a nonempty identifier.
 * @returns {void} Explicit checked native result; private causes remain host-only and failed work is not replayed.
 */
export function reactPrefix(
  value: unknown,
  required = false
): asserts value is string {
  if (
    typeof value !== 'string' ||
    (!value && required) ||
    (value !== '' && !/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(value))
  ) {
    throw new ReactAdapterError('INVALID_IDENTIFIER_PREFIX');
  }
}
/** Require a positive safe byte ceiling no higher than16 MiB; absent values use the explicit fallback.
 * @param {unknown} value - Unknown prefix/byte policy value validated before rendering.
 * @param {number} fallback - Default 1048576 bytes when the value is absent.
 * @returns {number} Explicit checked native result; private causes remain host-only and failed work is not replayed.
 */
export function reactByteLimit(value: unknown, fallback = 1048576): number {
  /** Validated finite byte ceiling; checked after trusted native rendering, not a CPU/allocation sandbox. */
  const limit = value ?? fallback;
  if (
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 16777216
  ) {
    throw new ReactAdapterError('INVALID_BYTE_LIMIT');
  }
  return limit;
}
/** Require identical stable React/React DOM18.3.1+ or19 versions. Equality cannot detect duplicate same-version module copies.
 * @param {unknown} reactVersion - Native installed React version, not a caller/browser claim.
 * @param {unknown} domVersion - Native installed React DOM version; must exactly equal React.
 * @returns {18|19} Explicit checked native result; private causes remain host-only and failed work is not replayed.
 */
export function validateReactVersions(
  reactVersion: unknown,
  domVersion: unknown
): 18 | 19 {
  if (
    typeof reactVersion !== 'string' ||
    reactVersion !== domVersion ||
    !/^(18|19)\.\d+\.\d+$/.test(reactVersion)
  ) {
    throw new ReactAdapterError('REACT_PEER_VERSION_MISMATCH');
  }
  /** Parsed stable matching peer version; unqualified prerelease/older versions reject. */
  const [major = Number.NaN, minor = Number.NaN, patch = Number.NaN] =
    reactVersion.split('.').map(Number);
  if (major === 18 && (minor < 3 || (minor === 3 && patch < 1))) {
    throw new ReactAdapterError('REACT_PEER_VERSION_MISMATCH');
  }
  return major as 18 | 19;
}
/** Normalize trusted peer ESM/CommonJS interop without executing arbitrary caller module paths.
 * @param {T} module - Already imported trusted peer module whose default interop is normalized.
 * @returns {T} Explicit checked native result; private causes remain host-only and failed work is not replayed.
 */
export function importedDefault<T>(module: T): T {
  return ((module as any).default ?? module) as T;
}
