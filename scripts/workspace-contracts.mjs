import fs from 'node:fs';
import path from 'node:path';
import { discoverWorkspaces } from './workspace-graph.mjs';

/**
 * Source-only public package contract preflight. Built files in dist/ are
 * verified by build:workspaces --verify; non-generated exports must already
 * exist in source control. Does not substitute for publishing smoke tests.
 */
/** Perform the inspect workspace contracts operation.
 * @param {unknown} root - Input value for root.
 * @returns {unknown} Result produced by inspect workspace contracts.
 */
export function inspectWorkspaceContracts(root) {
  /** Contract violations are accumulated so callers receive one actionable report. */
  const problems = [];
  /** Local value for entries. */
  const entries = discoverWorkspaces(root);
  for (const { name, dir, pkg } of entries.values()) {
    /** Local value for targets. */
    const targets = [];
    /**
     * Run the record callback.
     * @param {unknown} label - Input value for label.
     * @param {unknown} value - Input value for value.
     * @returns {unknown} Result produced by record.
     */
    const record = (label, value) => {
      if (typeof value === 'string') {
        targets.push({ label, value });
      } else if (value && typeof value === 'object') {
        for (const [key, target] of Object.entries(value)) {
          record(`${label}.${key}`, target);
        }
      } else {
        problems.push({
          package: name,
          field: label,
          reason: 'Expected a file target',
        });
      }
    };
    if (pkg.main !== undefined) {
      record('main', pkg.main);
    }
    if (pkg.types !== undefined) {
      record('types', pkg.types);
    }
    if (pkg.bin !== undefined) {
      record('bin', pkg.bin);
    }
    if (pkg.exports !== undefined) {
      record('exports', pkg.exports);
    }
    for (const { label, value } of targets) {
      if (
        !value.startsWith('./') ||
        value.includes('*') ||
        value.includes('\\') ||
        value.includes('\0') ||
        value.includes('?') ||
        value.includes('#')
      ) {
        problems.push({
          package: name,
          field: label,
          reason: `Invalid package entrypoint: ${value}`,
        });
        continue;
      }
      /** Local value for full. */
      const full = path.resolve(dir, value);
      if (!full.startsWith(dir + path.sep)) {
        problems.push({
          package: name,
          field: label,
          reason: `Entrypoint escapes package: ${value}`,
        });
        continue;
      }
      /** Local value for segments. */
      const segments = value.slice(2).split('/');
      if (segments.includes('.') || segments.includes('..')) {
        problems.push({
          package: name,
          field: label,
          reason: `Noncanonical entrypoint: ${value}`,
        });
        continue;
      }
      /** Local value for generated. */
      const generated = ['dist', 'build', 'lib'].includes(segments[0]);
      if (
        !generated &&
        !fs.statSync(full, { throwIfNoEntry: false })?.isFile()
      ) {
        problems.push({
          package: name,
          field: label,
          reason: `Missing committed asset: ${value}`,
        });
      }
    }
  }
  return { ok: problems.length === 0, checked: entries.size, problems };
}
