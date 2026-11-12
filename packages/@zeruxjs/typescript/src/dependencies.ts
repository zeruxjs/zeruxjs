import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import * as ts from 'typescript';

/** Node built-in names normalized without node: so they need no manifest dependency. */
const builtins = new Set(
  builtinModules.map((name) => name.replace(/^node:/, ''))
);

/** Diagnose literal bare imports against each source file's nearest owning manifest.
 * Does not execute imported packages or resolve through source-only aliases. Native
 * TypeScript diagnostics remain responsible for declarations and export subpaths.
 *
 * @param {ts.Program} program - Borrowed compiler program; its source text is inspected, never executed.
 * @param {string} cwd - Absolute project boundary used to exclude external source files.
 * @param {ts.CancellationToken} token - Borrowed synchronous cancellation checkpoint provider.
 * @returns {ts.Diagnostic[]} Errors for undeclared literal imports (95001) and invalid/missing owner manifests (95002).
 * @throws {Error} Propagates cancellation and unexpected compiler/filesystem failures.
 */
export function dependencyDiagnostics(
  program: ts.Program,
  cwd: string,
  token: ts.CancellationToken
): ts.Diagnostic[] {
  /** Invocation-owned result list; manifest errors and import errors remain compiler diagnostics. */
  const diagnostics: ts.Diagnostic[] = [];
  /** Invocation-local ownership cache; discarded so later checks observe manifest changes. */
  const manifests = new Map<string, { name?: string; declared: Set<string> }>();
  // source is borrowed compiler text; skip external packages before manifest checks.
  for (const source of program.getSourceFiles()) {
    token.throwIfCancellationRequested();
    /** Source location relative to the project boundary, used to exclude external files. */
    const relative = path.relative(cwd, source.fileName);
    if (
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      program.isSourceFileFromExternalLibrary(source) ||
      relative.split(path.sep).includes('node_modules')
    ) {
      continue;
    }
    // Resolve ownership from the source file, not the workspace root; sibling
    // packages cannot borrow declarations from one another's manifests.
    let directory = path.dirname(source.fileName);
    while (
      !fs.existsSync(path.join(directory, 'package.json')) &&
      directory !== cwd &&
      path.dirname(directory) !== directory
    ) {
      directory = path.dirname(directory);
    }
    /** Nearest owning package manifest for this source file. */
    const manifestPath = path.join(directory, 'package.json');
    let manifest = manifests.get(manifestPath);
    if (!manifest) {
      // Missing/malformed manifests are errors, not an empty passing dependency check.
      /** Manifest bytes read as configuration data, never loaded as executable code. */
      const text = ts.sys.readFile(manifestPath);
      /** Compiler JSON parse result; parse failures receive the manifest diagnostic code. */
      const parsed =
        text === undefined
          ? undefined
          : ts.parseConfigFileTextToJson(manifestPath, text);
      if (parsed?.error) {
        diagnostics.push({ ...parsed.error, code: 95002 });
        continue;
      }
      /** Parsed manifest candidate; validated before dependency sections are inspected. */
      const data = parsed?.config;
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        diagnostics.push({
          category: ts.DiagnosticCategory.Error,
          code: 95002,
          file: source,
          start: 0,
          length: 0,
          messageText: `Dependency check requires a valid owning package manifest: ${manifestPath}`,
        });
        continue;
      }
      /** Allowed dependency names from the four supported manifest sections. */
      const declared = new Set<string>();
      // section selects the four manifest maps accepted as dependency declarations.
      for (const section of [
        'dependencies',
        'devDependencies',
        'peerDependencies',
        'optionalDependencies',
      ]) {
        /** Candidate dependency section; each declared version must be a nonblank string. */
        const entries = data[section];
        if (
          entries !== undefined &&
          (!entries ||
            typeof entries !== 'object' ||
            Array.isArray(entries) ||
            Object.values(entries).some(
              (value) => typeof value !== 'string' || !value.trim()
            ))
        ) {
          diagnostics.push({
            category: ts.DiagnosticCategory.Error,
            code: 95002,
            file: source,
            start: 0,
            length: 0,
            messageText: `Invalid ${section} in ${manifestPath}`,
          });
        } else if (entries) {
          // name is a declared package identifier, not an executable import target.
          for (const name of Object.keys(entries)) {
            declared.add(name);
          }
        }
      }
      manifest = { name: data.name, declared };
      manifests.set(manifestPath, manifest);
    }
    /** Literal import records extracted by TypeScript without running the source module. */
    const imports = ts.preProcessFile(source.text, true, true).importedFiles;
    // entry carries literal specifier positions for source-addressable diagnostics.
    for (const entry of imports) {
      /** Original literal import path used for diagnostics and package-name extraction. */
      const specifier = entry.fileName;
      if (
        /^(?:[./#]|[a-zA-Z][\w+.-]*:)/.test(specifier) ||
        builtins.has(specifier)
      ) {
        continue;
      }
      /** Top-level package name; subpaths share their package dependency declaration. */
      const name = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];
      if (name === manifest.name || manifest.declared.has(name)) {
        continue;
      }
      diagnostics.push({
        category: ts.DiagnosticCategory.Error,
        code: 95001,
        file: source,
        start: entry.pos,
        length: entry.end - entry.pos,
        messageText: `Import '${specifier}' requires '${name}' in ${manifestPath} (dependencies, peerDependencies, optionalDependencies or devDependencies).`,
      });
    }
  }
  return diagnostics;
}
