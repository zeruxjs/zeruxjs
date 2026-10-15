#!/usr/bin/env node
/** Read-only, dependency-first public package plan. Never calls npm publish. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planPublicReleasesFromRoot } from './workspace-release-plan.mjs';
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--json')) {
  console.error('Usage: node scripts/package-release-plan.mjs [--json]'); process.exit(2);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = planPublicReleasesFromRoot(root);
if (args[0] === '--json') console.log(JSON.stringify(report, null, 2));
else {
  console.log(`[release-plan] ${report.publicPackages} public packages, ${report.privatePackages} private`);
  for (const pkg of report.order) console.log(`${String(pkg.sequence).padStart(2)}  ${pkg.name}@${pkg.version}  requires: ${pkg.dependencies.join(', ') || '(none)'}`);
  for (const warning of report.warnings) console.warn(`[release-plan] OPTIONAL: ${warning.package} -> ${warning.dependency} (not publicly installable yet)`);
  for (const issue of report.issues) console.error(`[release-plan] BLOCKED: ${JSON.stringify(issue)}`);
  console.log('[release-plan] This is an ordering check only. No packages have been published or approved.');
}
if (!report.ok) process.exitCode = 1;
