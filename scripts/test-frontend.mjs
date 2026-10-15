#!/usr/bin/env node
/** Section 78 reusable frontend gate. Requires TypeScript and @types/node installed. */
import {spawnSync} from 'node:child_process';
const tool=process.platform==='win32'?'tsc.cmd':'tsc';
const testEnv={...process.env,...(process.argv.includes('--browser')?{RUN_BROWSER_TESTS:'1'}:{})};
const run=(bin,args)=>{
 const result=spawnSync(bin,args,{stdio:'inherit',env:testEnv});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status??1);
};
for(const pkg of ['react','vue','zyro'])run(tool,['-p',`packages/@zeruxjs/${pkg}/tsconfig.json`,'--pretty','false']);
run(tool,['--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext',
 '--lib','ES2022,DOM,DOM.Iterable','--strict','--skipLibCheck','--declaration','--outDir','packages/zeruxjs/dist',
 'packages/zeruxjs/src/accessibility.ts','--pretty','false']);
run(process.execPath,['--test',
 ...['react','vue','zyro'].flatMap(pkg=>['advanced','integration'].map(test=>`packages/@zeruxjs/${pkg}/test/${test}.test.mjs`)),
 'packages/@zeruxjs/react/test/section78-ssr-lifecycle.test.mjs',
 'packages/@zeruxjs/vue/test/section78-vue-scope.test.mjs',
 'packages/@zeruxjs/zyro/test/section78-scope.test.mjs',
 'packages/zeruxjs/test/accessibility.test.mjs',
 'tests/browser/harness.test.mjs','tests/browser/section78.test.mjs']);
