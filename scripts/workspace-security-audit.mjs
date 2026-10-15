import fs from 'node:fs';
import path from 'node:path';
import { discoverWorkspaces } from './workspace-graph.mjs';
import { inspectWorkspaceLock } from './workspace-lock.mjs';
import { verifyPublicApiFreeze } from './workspace-api-freeze.mjs';

const forbiddenInstallHooks = new Set(['preinstall', 'install', 'postinstall']);
const execProtocol = /^(?:git\+|git:|file:|https?:|ssh:|github:)/i;
const secretPattern = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}/;
/** Dependency-source audit is OFFLINE and deliberately NOT a vulnerability/license database check. */
export function inspectPackageReleaseSecurity(root) {
  const issues = [], advisories = [];
  const workspaces = discoverWorkspaces(root);
  for (const { name, pkg, dir } of workspaces.values()) {
    if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version ?? '')) issues.push({ code: 'VERSION', package: name });
    if (!pkg.private && (typeof pkg.license !== 'string' || !pkg.license.trim())) issues.push({ code: 'LICENSE', package: name });
    if (pkg.scripts) for (const hook of Object.keys(pkg.scripts)) if (forbiddenInstallHooks.has(hook)) issues.push({ code: 'INSTALL_HOOK', package: name, hook });
    for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [dep, version] of Object.entries(pkg[kind] ?? {})) {
        if (execProtocol.test(version) || String(version).includes('\n')) issues.push({ code: 'REMOTE_DEPENDENCY', package: name, dependency: dep });
      }
    }
    for (const filename of ['package.json', 'README.md']) {
      const filepath = path.join(dir, filename);
      if (fs.existsSync(filepath) && secretPattern.test(fs.readFileSync(filepath, 'utf8'))) issues.push({ code: 'PRIVATE_KEY', package: name, filename });
    }
    // Source-owned credentials must never ship in release archives. Do not inspect
    // generated outputs, fixtures or docs for this check; those require manual review.
    for (const subdir of ['src', 'assets']) {
      const start = path.join(dir, subdir);
      if (!fs.existsSync(start)) continue;
      const pending = [start]; let visited = 0;
      while (pending.length) {
        const current = pending.pop();
        if (++visited > 20_000) { issues.push({ code: 'SOURCE_SCAN_LIMIT', package: name }); break; }
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink()) { issues.push({ code: 'SOURCE_SYMLINK', package: name }); continue; }
        if (stat.isDirectory()) {
          for (const child of fs.readdirSync(current)) pending.push(path.join(current, child));
        } else if (stat.isFile() && /\.(?:[cm]?js|tsx?|jsx|json|pem|key)$/i.test(current)) {
          if (stat.size > 4 * 1024 * 1024) { issues.push({ code: 'UNSCANNED_SOURCE', package: name }); continue; }
          if (secretPattern.test(fs.readFileSync(current, 'utf8'))) issues.push({ code: 'EMBEDDED_CREDENTIAL', package: name, file: path.relative(dir, current) });
        }
      }
    }
    if (pkg.private) advisories.push({ code: 'PRIVATE_PACKAGE', package: name });
    if (pkg.engines?.node === undefined) advisories.push({ code: 'UNPINNED_NODE_ENGINE', package: name });
  }
  const lock = inspectWorkspaceLock(root);
  if (lock.staleWorkspaceMetadata) issues.push({ code: 'STALE_LOCK_METADATA' });
  if (lock.insecureResolutions.length) issues.push({ code: 'HTTP_DEPENDENCY_RESOLUTION', count: lock.insecureResolutions.length });
  if (lock.malformedEntries.length) issues.push({ code: 'MALFORMED_LOCK_ENTRIES', count: lock.malformedEntries.length });
  const api = verifyPublicApiFreeze(root);
  if (!api.ok) issues.push({ code: 'API_FREEZE_DRIFT', changes: api.issues });
  if (lock.unresolvedExternal.length || lock.missingDependencies.length) advisories.push({ code: 'CLEAN_INSTALL_BLOCKED', unresolved: lock.unresolvedExternal.length, graphMissing: lock.missingDependencies.length });
  advisories.push({ code: 'ADVISORY_DATABASE_NOT_QUERIED', note: 'Run npm audit and license compliance tools in a clean online checkout.' });
  return { ok: !issues.length, examined: workspaces.size, issues, advisories, certification: 'offline-source-only; NOT security or publish certification' };
}
