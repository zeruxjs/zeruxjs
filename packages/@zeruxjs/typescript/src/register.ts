import { createRequire } from 'node:module';
import { transpileTypescriptFile } from './transform.js';

/** Legacy CommonJS require() support. ESM imports use the ./loader subpath instead. */
export function registerTypescript(options: { extensions?: string[] } = {}): () => void {
  const req = createRequire(import.meta.url);
  const handlers = req.extensions;
  const extensions = options.extensions ?? ['.ts', '.tsx', '.cts'];
  if (!Array.isArray(extensions) || extensions.length > 3 || new Set(extensions).size !== extensions.length ||
      extensions.some(extension => typeof extension !== 'string' || !/^\.(?:ts|tsx|cts)$/.test(extension))) {
    throw new TypeError('extensions must contain unique .ts, .tsx or .cts entries');
  }
  const previous = new Map<string, NodeJS.RequireExtensions[string] | undefined>();
  for (const extension of extensions) {
    previous.set(extension, handlers[extension]);
    handlers[extension] = (mod, filename) => {
      const result = transpileTypescriptFile(filename, { format: 'cjs', sourceMap: false });
      (mod as NodeModule & { _compile: (code: string, path: string) => void })._compile(result.code, filename);
    };
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    for (const [extension, handler] of previous) {
      if (handler) handlers[extension] = handler;
      else delete handlers[extension];
    }
  };
}
