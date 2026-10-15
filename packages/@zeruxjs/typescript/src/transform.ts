import * as ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

export type ScriptFormat = 'esm' | 'cjs';
export interface TransformOptions { filename?: string; format?: ScriptFormat; sourceMap?: boolean; target?: ts.ScriptTarget }
/** Transpiles a TypeScript file without type-checking. Use checkTypes for diagnostics. */
export function transformTypescript(source: string, options: TransformOptions = {}): { code: string; map?: string } {
  const name = options.filename ?? 'module.ts';
  const extension = path.extname(name).toLowerCase();
  const jsx = extension === '.tsx' ? ts.JsxEmit.ReactJSX : ts.JsxEmit.Preserve;
  const result = ts.transpileModule(source, {
    fileName: name, reportDiagnostics: true,
    compilerOptions: {
      target: options.target ?? ts.ScriptTarget.ES2022,
      module: options.format === 'cjs' ? ts.ModuleKind.CommonJS : ts.ModuleKind.ESNext,
      jsx,
      sourceMap: options.sourceMap ?? false,
      esModuleInterop: true
    }
  });
  const errors = result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) ?? [];
  if (errors.length) throw new Error(ts.formatDiagnostics(errors, {
    getCanonicalFileName: f => f,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => '\n'
  }));
  return { code: result.outputText, map: result.sourceMapText };
}

export function transpileTypescriptFile(filename: string, options: Omit<TransformOptions, 'filename'> = {}) {
  return transformTypescript(fs.readFileSync(filename, 'utf8'), { ...options, filename });
}

export interface TypecheckOptions { files: string[]; cwd?: string; configFile?: string }
export function checkTypes(options: TypecheckOptions) {
  const base = path.resolve(options.cwd ?? process.cwd());
  const configPath = options.configFile ? path.resolve(base, options.configFile) : ts.findConfigFile(base, ts.sys.fileExists);
  let config: ts.ParsedCommandLine | undefined;
  if (configPath) {
    const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
    if (loaded.error) return { ok: false, diagnostics: [loaded.error] };
    config = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(configPath));
  }
  const files = options.files.length ? options.files.map(file => path.resolve(base, file)) : config?.fileNames ?? [];
  const program = ts.createProgram(files, { ...config?.options, noEmit: true });
  const diagnostics = [...(config?.errors ?? []), ...ts.getPreEmitDiagnostics(program)];
  return { ok: diagnostics.length === 0, diagnostics };
}
