import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRunner,EnvironmentUnavailableError,skipTest,normalizeResults,normalizeV8Coverage,mergeCoverage,summarizeCoverage} from 'ztrial';
import {createBrowserRunner,runBrowserTests,withBrowser,runE2E,visit,click} from 'ztrial/playwright';
import {formatSummary} from '../dist/utils/logger.js';

function driver({launchError,hookError,pageCloseError,late=0}={}){
 const counts={launches:0,browsers:0,contexts:0,pages:0,active:0,peak:0,screenshots:0,traces:0,videos:0};
 const created=[];
 const makeBrowser=()=>({version:()=> 'test-driver-1',close:async()=>{counts.browsers++;},newContext:async options=>{
  counts.active++;counts.peak=Math.max(counts.peak,counts.active);
  let page;
  const context={close:async()=>{counts.contexts++;counts.active--;},tracing:{start:async()=>{},stop:async({path})=>{counts.traces++;await writeFile(path,'trace');}},newPage:async()=>{
   page={goto:async()=>{},locator:()=>({count:async()=>1,click:async()=>{}}),setContent:async()=>{},title:async()=>'fixture',setDefaultTimeout:()=>{},close:async()=>{counts.pages++;if(pageCloseError)throw pageCloseError;},screenshot:async({path})=>{counts.screenshots++;await writeFile(path,'image');},video:()=>options.recordVideo?{saveAs:async file=>{counts.videos++;await writeFile(file,'video');}}:null,coverage:{startJSCoverage:async()=>{},stopJSCoverage:async()=>[{url:'https://test.invalid/app.js',source:'abc',functions:[{isBlockCoverage:true,ranges:[{startOffset:0,endOffset:3,count:1}]}]}]}};created.push(page);return page;
  }};return context;
 }});
 return {counts,created,browser:makeBrowser(),driver:{chromium:{launch:async()=>{counts.launches++;if(launchError)throw launchError;if(late)await new Promise(resolve=>setTimeout(resolve,late));return makeBrowser();}}}};
}

test('owned browser resources close after hook/test failure; skips never allocate a browser',async()=>{
 const fixture=driver();const hooks=[];
 const result=await runBrowserTests([{name:'normal',run:async({page})=>{await visit(page,'https://test.invalid');await click(page,'button');await runE2E(page,[async()=>{}]);}},{name:'failing',run:()=>{throw Error('assertion failed');}},{name:'skip',skip:true,run:()=>assert.fail('not run')}],{driver:fixture.driver,afterEach:[()=>{hooks.push('after');}]});
 assert.deepEqual([result.passed,result.failed,result.skipped,result.unavailable],[1,1,1,0]);assert.equal(fixture.counts.pages,2);assert.equal(fixture.counts.contexts,2);assert.equal(fixture.counts.browsers,2);assert.deepEqual(hooks,['after','after']);
 const failure=driver();const hook=await runBrowserTests([{name:'setup fails',run:()=>assert.fail('not run')}],{driver:failure.driver,beforeEach:[()=>{throw Error('hook failed');}],afterEach:[()=>hooks.push('cleanup')]});
 assert.equal(hook.failed,1);assert.equal(failure.counts.contexts,1);assert.equal(failure.counts.browsers,1);assert.equal(hooks.at(-1),'cleanup');
});

test('parallel bounds and independent runner registries preserve result order',async()=>{
 const fixture=driver();const first=createBrowserRunner({driver:fixture.driver,concurrency:2});const second=createBrowserRunner({driver:fixture.driver});
 for(let index=0;index<5;index++)first.test('case '+index,()=>new Promise(resolve=>setTimeout(resolve,3)));second.skip('unrelated');
 const [a,b]=await Promise.all([first.runTests(),second.runTests()]);assert.equal(a.passed,5);assert.equal(b.skipped,1);assert.ok(fixture.counts.peak<=2);assert.deepEqual(a.results.map(result=>result.name),['case 0','case 1','case 2','case 3','case 4']);
});

test('borrowed browser stays open; timeout, cancellation and late launch release owned sessions',async()=>{
 const fixture=driver();const borrowed=await runBrowserTests([{name:'borrow',run:()=>{}}],{browser:fixture.browser});assert.equal(borrowed.passed,1);assert.equal(fixture.counts.browsers,0);assert.equal(fixture.counts.contexts,1);
 const timed=driver();const result=await runBrowserTests([{name:'pending',run:()=>new Promise(()=>{})}],{driver:timed.driver,timeoutMs:10});assert.equal(result.failed,1);assert.equal(result.results[0].reason,'timeout');assert.equal(timed.counts.pages,1);assert.equal(timed.counts.browsers,1);
 const controller=new AbortController();controller.abort();const cancelled=await runBrowserTests([{name:'cancelled',run:()=>{}}],{driver:fixture.driver,signal:controller.signal});assert.equal(cancelled.failed,1);assert.equal(cancelled.results[0].reason,'cancelled');
 const late=driver({late:25});const deadline=await runBrowserTests([{name:'late launch',run:()=>{}}],{driver:late.driver,timeoutMs:5});assert.equal(deadline.failed,1);await new Promise(resolve=>setTimeout(resolve,40));assert.equal(late.counts.browsers,1);
});

test('environment unavailable is not a failed assertion or intentional skip in backend/reporters',async()=>{
 const fixture=driver({launchError:new Error('browser executable unavailable')});
 const frontend=await runBrowserTests([{name:'unavailable',run:()=>{}}],{driver:fixture.driver});assert.equal(frontend.unavailable,1);assert.equal(frontend.failed,0);assert.equal(frontend.skipped,0);assert.equal(frontend.results[0].error.cause.message,'browser executable unavailable');
 const runner=createRunner();runner.test('optional environment',()=>{throw new EnvironmentUnavailableError('browser');});runner.test('explicit skip',()=>skipTest('intentional'));runner.test('ordinary failure',()=>{throw Error('failure');});
 const backend=await runner.runTests();assert.deepEqual([backend.unavailable,backend.skipped,backend.failed],[1,1,1]);assert.match(formatSummary(backend,'tap'),/not ok 1.*environment-unavailable/);assert.match(formatSummary(backend,'tap'),/ok 2.*SKIP/);assert.equal(normalizeResults(backend)[0].status,'environment-unavailable');
});

test('withBrowser integrates runner cancellation/cleanup and cleanup errors cannot become skips',async()=>{
 const fixture=driver();const runner=createRunner();runner.test('browser pending',context=>withBrowser({driver:fixture.driver,timeoutMs:1000},()=>new Promise(()=>{}),context));
 const summary=await runner.runTests({timeoutMs:15});assert.equal(summary.failed,1);assert.equal(fixture.counts.contexts,1);assert.equal(fixture.counts.browsers,1);
 const failed=driver({pageCloseError:Error('page close failed')});const result=await runBrowserTests([{name:'cleanup',run:()=>skipTest('intentional')}],{driver:failed.driver});assert.equal(result.failed,1);assert.equal(result.skipped,0);assert.equal(failed.counts.contexts,1);assert.equal(failed.counts.browsers,1);
 const backend=createRunner();backend.test('skip then failed teardown',()=>skipTest('skip'));backend.afterEach(()=>{throw Error('teardown failed');});assert.equal((await backend.runTests()).failed,1);
});

test('captures are opt-in with private generated paths and no test-name interpolation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ztrial-artifacts-'));
 try{
  const none=driver();await runBrowserTests([{name:'../../unsafe',run:()=>{}}],{driver:none.driver});assert.equal(none.counts.screenshots+none.counts.traces+none.counts.videos,0);assert.deepEqual(await readdir(root),[]);
  const fixture=driver();const result=await runBrowserTests([{name:'../../unsafe',run:()=>{}}],{driver:fixture.driver,artifacts:{directory:root,screenshot:true,trace:true,video:true}});assert.equal(result.passed,1);assert.equal(result.results[0].artifacts.length,3);
  for(const artifact of result.results[0].artifacts){assert.ok(!artifact.path.includes('..'));assert.ok(!artifact.path.startsWith('/'));assert.ok((await readFile(join(root,artifact.path))).length>0);}
  await assert.rejects(runBrowserTests([],{artifacts:{directory:root+'/../escape',trace:true}}),/artifact/);
  const link=root+'-link';await symlink(root,link,'dir');try{await assert.rejects(runBrowserTests([],{artifacts:{directory:link,trace:true}}),/symlink/);}finally{await rm(link,{force:true});}
 }finally{await rm(root,{recursive:true,force:true});}
});

test('coverage reports missing/unsupported instrumentation and merges only compatible captures',async()=>{
 const input=[{url:'file:///app.js',source:'abc',functions:[{isBlockCoverage:true,ranges:[{startOffset:0,endOffset:3,count:1}]}]}];
 const first=normalizeV8Coverage(input,{runtime:'node:test-version',expectedSources:['file:///app.js','file:///missing.js']});
 assert.equal(first[1].status,'uninstrumented');assert.equal(summarizeCoverage(first).uninstrumentedSources,1);
 const merged=mergeCoverage([...first,...first]);assert.equal(merged[0].ranges[0].count,2);
 assert.throws(()=>mergeCoverage([first[0],{...first[0],runtime:'chromium:other'}]),/Incompatible/);
 assert.throws(()=>mergeCoverage([first[0],{...first[0],sourceHash:'a'.repeat(64)}]),/Incompatible/);
 assert.throws(()=>normalizeV8Coverage([{...input[0],functions:[{isBlockCoverage:true,ranges:[{startOffset:0,endOffset:4,count:1}]}]}],{runtime:'node:test',expectedSources:['file:///app.js']}),/range/);
 const fixture=driver();const result=await runBrowserTests([{name:'coverage',run:()=>{}}],{driver:fixture.driver,coverage:{expectedSources:['https://test.invalid/app.js','https://test.invalid/not-loaded.js']}});assert.equal(result.results[0].coverage[0].status,'instrumented');assert.equal(result.results[0].coverage[1].status,'uninstrumented');assert.ok(!JSON.stringify(result.results[0].coverage).includes('"source":"abc"'));
 const unsupported=await runBrowserTests([{name:'unsupported',run:()=>{}}],{browser:fixture.browser,browserName:'firefox',coverage:{expectedSources:['app.js']}});assert.equal(unsupported.results[0].coverage[0].status,'unsupported');
});

test('invalid browser options reject before driver allocation and backend runners stay isolated',async()=>{
 const fixture=driver();for(const options of [{concurrency:0},{timeoutMs:0},{browserName:'unknown'},{artifacts:{directory:'../escape',trace:true}},{coverage:{expectedSources:['a','a']}}])await assert.rejects(runBrowserTests([],{...options,driver:fixture.driver}));assert.equal(fixture.counts.launches,0);
 const a=createRunner(),b=createRunner();a.test('fail',()=>{throw Error('expected');});b.test('pass',()=>{});const [one,two]=await Promise.all([a.runTests(),b.runTests()]);assert.equal(one.failed,1);assert.equal(two.passed,1);
});

test('optional installed environment check reports unavailable without installing or launching apps',async t=>{
 try{import.meta.resolve('playwright');t.diagnostic('Playwright installed: real browser execution is handled only by the optional browser smoke check');}
 catch{const result=await runBrowserTests([{name:'missing dependency',run:()=>assert.fail('not run')}]);assert.equal(result.unavailable,1);assert.equal(result.failed,0);assert.equal(result.skipped,0);}
});

test('CLI and throwOnFailure preserve unavailable outcomes instead of reporting green',async()=>{
 const {main}=await import('../dist/bin/cli.js');const root=await mkdtemp(join(tmpdir(),'ztrial-unavailable-'));const entry=new URL('../dist/index.js',import.meta.url).href;
 const original=process.stdout.write;let output='';
 try{
  await writeFile(join(root,'environment.test.mjs'),`import {test,EnvironmentUnavailableError} from ${JSON.stringify(entry)};test('optional browser',()=>{throw new EnvironmentUnavailableError('browser');});`);
  await writeFile(join(root,'config.json'),JSON.stringify({root,files:['**/*.test.mjs'],reporter:'tap'}));
  process.stdout.write=value=>{output+=String(value);return true;};assert.equal(await main(['--config',join(root,'config.json'),'--match','optional']),2);
 }finally{process.stdout.write=original;await rm(root,{recursive:true,force:true});}
 assert.match(output,/not ok.*environment-unavailable/);assert.doesNotMatch(output,/# SKIP/);
 const runner=createRunner();runner.test('unavailable',()=>{throw new EnvironmentUnavailableError('browser');});await assert.rejects(runner.runTests({throwOnFailure:true}),/unavailable/);
});

test('closed runner scope rejects late browser setup without leaking parent signal listeners',async()=>{
 const {getEventListeners}=await import('node:events');const controller=new AbortController();const count=getEventListeners(controller.signal,'abort').length;const fixture=driver();
 const scope={signal:new AbortController().signal,onCleanup:()=>{throw Error('scope closed');}};
 await assert.rejects(withBrowser({driver:fixture.driver,signal:controller.signal},()=>{},scope),/scope closed/);assert.equal(getEventListeners(controller.signal,'abort').length,count);assert.equal(fixture.counts.launches,0);
});
