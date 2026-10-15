#!/usr/bin/env node
/** Read-only offline developer environment diagnostic, not a release certificate. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectWorkspaceLock} from './workspace-lock.mjs';
import {inspectWorkspaceContracts} from './workspace-contracts.mjs';
import {discoverWorkspaces,planWorkspaces} from './workspace-graph.mjs';

export function inspectDeveloperWorkspace(root) {
 const lock=inspectWorkspaceLock(root);
 const contracts=inspectWorkspaceContracts(root);
 const entries=discoverWorkspaces(root);
 const plan=planWorkspaces(entries);
 return {
  node:process.versions.node,
  platform:process.platform,
  architecture:process.arch,
  workspaces:entries.size,
  plannedBuilds:plan.ordered.length,
  sourceContracts:{ok:contracts.ok,problems:contracts.problems},
  lock:{ok:lock.ok,staleMetadata:lock.staleWorkspaceMetadata,unresolvedExternal:lock.unresolvedExternal,missingDependencyEdges:lock.missingDependencies,malformedEntries:lock.malformedEntries,insecureResolutions:lock.insecureResolutions},
  readyForCleanInstall:lock.ok && contracts.ok,
  note:'Offline source and lock diagnostics only. Clean npm ci, builds, test execution and live services require separate verification.'
 };
}
export function doctorMain(argv=[],root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),log=console.log,errorLog=console.error) {
 if(argv.some(v=>!['--json','--strict'].includes(v))) {errorLog('Usage: node scripts/doctor.mjs [--json] [--strict]');return 2;}
 try {
  const report=inspectDeveloperWorkspace(root);
  if(argv.includes('--json')) log(JSON.stringify(report,null,2));
  else {
   log(`[doctor] Node ${report.node} / ${report.platform}-${report.architecture}`);
   log(`[doctor] ${report.workspaces} workspaces; ${report.plannedBuilds} build targets; source contracts: ${report.sourceContracts.ok?'PASS':'FAIL'}`);
   log(`[doctor] Lockfile: ${report.lock.ok?'PASS':'BLOCKED'} (${report.lock.unresolvedExternal.length} unresolved third-party packages)`);
   log('[doctor] This diagnostic does not run npm ci, TypeScript builds, browsers, or live provider tests.');
  }
  return argv.includes('--strict')&&!report.readyForCleanInstall ? 1 : 0;
 } catch(error) {errorLog(`[doctor] ${error instanceof Error?error.message:String(error)}`);return 1;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) process.exitCode=doctorMain(process.argv.slice(2));
