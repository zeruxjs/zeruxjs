import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import * as ts from 'typescript';

const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')));

/** Diagnose literal bare imports against each source file's nearest owning manifest.
 * Does not execute imported packages or resolve through source-only aliases. Native
 * TypeScript diagnostics remain responsible for declarations and export subpaths.
 */
export function dependencyDiagnostics(program: ts.Program, cwd: string, token: ts.CancellationToken): ts.Diagnostic[] {
  const diagnostics: ts.Diagnostic[] = [];
  const manifests = new Map<string, { name?: string; declared: Set<string> }>();
  for (const source of program.getSourceFiles()) {
    token.throwIfCancellationRequested();
    const relative = path.relative(cwd, source.fileName);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || program.isSourceFileFromExternalLibrary(source) || relative.split(path.sep).includes('node_modules')) continue;
    let directory = path.dirname(source.fileName);
    while (!fs.existsSync(path.join(directory, 'package.json')) && directory !== cwd && path.dirname(directory) !== directory) {
      directory = path.dirname(directory);
    }
    const manifestPath = path.join(directory, 'package.json');
    let manifest = manifests.get(manifestPath);
    if (!manifest) {
      // Missing/malformed manifests are errors, not an empty passing dependency check.
      const text = ts.sys.readFile(manifestPath);
      const parsed = text === undefined ? undefined : ts.parseConfigFileTextToJson(manifestPath, text);
      if (parsed?.error) { diagnostics.push({ ...parsed.error, code: 95002 }); continue; }
      const data = parsed?.config;
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        diagnostics.push({ category: ts.DiagnosticCategory.Error, code: 95002, file: source,
          start: 0, length: 0, messageText: `Dependency check requires a valid owning package manifest: ${manifestPath}` });
        continue;
      }
      const declared = new Set<string>();
      for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const entries = data[section];
        if (entries !== undefined && (!entries || typeof entries !== 'object' || Array.isArray(entries) || Object.values(entries).some(value => typeof value !== 'string' || !value.trim()))) {
          diagnostics.push({ category: ts.DiagnosticCategory.Error, code: 95002, file: source,
            start: 0, length: 0, messageText: `Invalid ${section} in ${manifestPath}` });
        } else if (entries) {
          for (const name of Object.keys(entries)) declared.add(name);
        }
      }
      manifest = { name: data.name, declared };
      manifests.set(manifestPath, manifest);
    }
    const imports = ts.preProcessFile(source.text, true, true).importedFiles;
    for (const entry of imports) {
      const specifier = entry.fileName;
      if (/^(?:[./#]|[a-zA-Z][\w+.-]*:)/.test(specifier) || builtins.has(specifier)) continue;
      const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
      if (name === manifest.name || manifest.declared.has(name)) continue;
      diagnostics.push({ category: ts.DiagnosticCategory.Error, code: 95001, file: source,
        start: entry.pos, length: entry.end - entry.pos,
        messageText: `Import '${specifier}' requires '${name}' in ${manifestPath} (dependencies, peerDependencies, optionalDependencies or devDependencies).` });
    }
  }
  return diagnostics;
}
