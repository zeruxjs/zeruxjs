#!/usr/bin/env node
/** Dependency-order build of CLI/dev/test/watch packages and their tests. */
import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const packages=['zcli','zeyro','zwatch','z-dev'];
for(const name of packages) {
 const result=spawnSync(process.execPath,['scripts/build-workspaces.mjs','--scope',name,'--verify'],{cwd:root,stdio:'inherit',timeout:300_000});
 if(result.error || result.status!==0) {console.error(`[developer] Build ${name} failed. Install dependencies with npm ci first.`);process.exit(1);}
 const files=readdirSync(path.join(root,'packages',name,'test')).filter(file=>file.endsWith('.test.mjs')).sort().map(file=>`packages/${name}/test/${file}`);
 const tests=spawnSync(process.execPath,['--test',...files],{cwd:root,stdio:'inherit',timeout:180_000});
 if (tests.error || tests.status!==0) {console.error(`[developer] Test ${name} failed: ${tests.error?.message??tests.status}`);process.exit(1);}
}
console.log('[developer] All selected package builds/tests passed (not a clean-install or browser certificate).');
