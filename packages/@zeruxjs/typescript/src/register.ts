import { createRequire } from 'node:module';
import { transpileTypescriptFile } from './transform.js';

/** Legacy CommonJS require() support. ESM imports use the ./loader subpath instead. */
export function registerTypescript(options: { extensions?: string[] } = {}): () => void {
  const req = createRequire(import.meta.url);
  const handlers = req.extensions;
  const extensions = options.extensions ?? ['.ts', '.tsx', '.cts'];
  const previous = new Map<string, NodeJS.RequireExtensions[string] | undefined>();
  for (const extension of extensions) {
    if (!/^\.(?:ts|tsx|cts)$/.test(extension)) throw new Error(`Unsupported require extension: ${extension}`);
    previous.set(extension, handlers[extension]);
    handlers[extension] = (mod, filename) => {
      const result = transpileTypescriptFile(filename, { format: 'cjs', sourceMap: false });
      (mod as NodeModule & { _compile: (code: string, path: string) => void })._compile(result.code, filename);
    };
  }
  return () => {
    for (const extension of extensions) {
      if (previous.get(extension)) handlers[extension] = previous.get(extension)!;
      else delete handlers[extension];
    }
  };
}
