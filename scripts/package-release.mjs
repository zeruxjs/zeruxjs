#!/usr/bin/env node
/** Read-only npm package inventory, no publish or version mutation. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectPublishableWorkspaces } from './workspace-package-release.mjs';
import { inspectWorkspaceLock } from './workspace-lock.mjs';
import { inspectWorkspaceContracts } from './workspace-contracts.mjs';
import { planPublicReleasesFromRoot } from './workspace-release-plan.mjs';
import { verifyPublicApiFreeze } from './workspace-api-freeze.mjs';
import { inspectPackageReleaseSecurity } from './workspace-security-audit.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flags = new Set(process.argv.slice(2));
if ([...flags].some(flag => !['--built','--strict','--json'].includes(flag)) || flags.size !== process.argv.length - 2) {
  console.error('Usage: node scripts/package-release.mjs [--built] [--strict] [--json]'); process.exit(2);
}
const built = flags.has('--built');
const packageReport = inspectPublishableWorkspaces(root, { built });
const lock = inspectWorkspaceLock(root);
const contracts = inspectWorkspaceContracts(root);
const releasePlan = planPublicReleasesFromRoot(root);
const freeze = verifyPublicApiFreeze(root);
const security = inspectPackageReleaseSecurity(root);
const blockers = [];
if (!lock.ok) blockers.push({ id: 'PKG-001', detail: `${lock.unresolvedExternal.length} unresolved external dependency lock entries; clean npm ci not certified` });
if (!contracts.ok) blockers.push({ id: 'PKG-007', detail: `${contracts.problems.length} invalid source contract(s)` });
if (!releasePlan.ok) blockers.push({ id: 'PKG-010', detail: `${releasePlan.issues.length} public dependency graph issue(s)` });
if (!freeze.ok) blockers.push({ id: 'PKG-007', detail: `${freeze.issues.length} unapproved public API contract change(s)` });
if (!security.ok) blockers.push({ id: 'PKG-004', detail: `${security.issues.length} offline security issue(s)` });
for (const item of packageReport.packages.filter(pkg => pkg.publishable)) {
  for (const issue of item.errors) blockers.push({ id: 'PKG-010', package: item.name, ...issue });
}
if (built && !packageReport.stableCandidate) blockers.push({ id: 'PKG-007', detail: 'Stable-version and distributable-artifact review is incomplete' });
const result = {
  schemaVersion: 1,
  decision: 'NO_GO',
  reason: 'A source/tarball audit cannot substitute for clean installation, online advisories, live provider/browser acceptance, cross-platform consumers, and named human release approval.',
  mode: packageReport.mode,
  sourceChecks: { lockComplete: lock.ok, contractValid: contracts.ok, apiFreezeValid: freeze.ok, offlineSecurityValid: security.ok },
  artifactChecks: packageReport,
  releasePlan,
  blockers,
  requiredExternalGates: ['Node 22/24 clean npm ci and builds', 'online production vulnerability and license review', 'live-provider recovery/fault acceptance', 'real-browser and cross-platform runtime/typing tests', 'reviewed and approved stable semver and migration policy', 'manual maintainer release authorization'],
  publishAttempted: false,
};
console.log(JSON.stringify(flags.has('--json') ? result : {
  decision: result.decision,
  mode: result.mode,
  publicPackages: packageReport.publicPackages,
  privatePackages: packageReport.privatePackages,
  releaseOrder: releasePlan.order.map(item => item.name),
  blockers: blockers.slice(0, 60),
  requiredExternalGates: result.requiredExternalGates,
  publishAttempted: false,
}, null, 2));
if (flags.has('--strict') && (blockers.length || !packageReport.stableCandidate || !built)) process.exitCode = 1;
