import { createRequire } from 'node:module';
import { transpileTypescriptFile } from './transform.js';

/** Install process-wide CommonJS transpilation hooks for the requested extensions.
 * Returns an idempotent disposer restoring the captured handlers. Invalid extension
 * lists reject before mutation; ESM imports use the ./loader subpath instead.
 * Required modules execute normally: this hook is not a sandbox. Nested callers
 * must dispose in reverse registration order to restore their predecessor hooks.
 *
 * @param {{extensions?: string[]}} options - Hook selection; extensions defaults to .ts, .tsx and .cts.
 * @param {string[]} [options.extensions] - Unique supported suffixes; an empty array installs no hooks.
 * @returns {() => void} Idempotent synchronous disposer restoring captured process-wide handlers.
 * @throws {TypeError} When extensions is not a supported unique list; no hooks change on that validation failure.
 */
export function registerTypescript(
  options: { extensions?: string[] } = {}
): () => void {
  /** Module-local require handle exposing the process-wide CommonJS extension table. */
  const req = createRequire(import.meta.url);
  /** Borrowed global extension registry; the disposer restores captured entries. */
  const handlers = req.extensions;
  /** Requested suffixes, validated in full before any global mutation. */
  const extensions = options.extensions ?? ['.ts', '.tsx', '.cts'];
  if (
    !Array.isArray(extensions) ||
    extensions.length > 3 ||
    new Set(extensions).size !== extensions.length ||
    extensions.some(
      (extension) =>
        typeof extension !== 'string' || !/^\.(?:ts|tsx|cts)$/.test(extension)
    )
  ) {
    throw new TypeError(
      'extensions must contain unique .ts, .tsx or .cts entries'
    );
  }
  // Validate the whole list above before replacing any process-global handler.
  /** Captured extension handlers restored by this registration in reverse ownership order. */
  const previous = new Map<
    string,
    NodeJS.RequireExtensions[string] | undefined
  >();
  // extension is already allowlisted; capture its old handler before replacement.
  for (const extension of extensions) {
    previous.set(extension, handlers[extension]);
    handlers[extension] = (mod, filename) => {
      /** CommonJS output compiled from the trusted local module before Node executes it. */
      const result = transpileTypescriptFile(filename, {
        format: 'cjs',
        sourceMap: false,
      });
      (
        mod as NodeModule & { _compile: (code: string, path: string) => void }
      )._compile(result.code, filename);
    };
  }
  let disposed = false;
  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    // Each captured extension/handler pair belongs to this registration only.
    for (const [extension, handler] of previous) {
      if (handler) {
        handlers[extension] = handler;
      } else {
        delete handlers[extension];
      }
    }
  };
}
