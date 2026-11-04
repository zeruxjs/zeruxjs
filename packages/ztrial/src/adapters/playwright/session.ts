import { lstat, realpath, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { EnvironmentUnavailableError, failureStatus } from '../../results.js';
import { normalizeV8Coverage, type CoverageRecord, type V8SourceCoverage } from '../../coverage.js';
import type { RunSummary, TestResult, TestExecutionContext } from '../../types/test.js';
import type { PageLike } from './page.js';
export interface BrowserPage extends PageLike {
  close():Promise<void>; setDefaultTimeout(ms:number):void;
  setContent(html:string,options?:{timeout?:number}):Promise<void>; title():Promise<string>;
  screenshot(options:{path:string;timeout:number}):Promise<unknown>;
  coverage?:{startJSCoverage(options?:{resetOnNavigation?:boolean;reportAnonymousScripts?:boolean}):Promise<void>;stopJSCoverage():Promise<V8SourceCoverage[]>};
  video():{saveAs(file:string):Promise<void>}|null;
}
export interface BrowserContextLike {
  newPage():Promise<BrowserPage>; close():Promise<void>;
  tracing:{start(options:{screenshots:boolean;snapshots:boolean;sources:boolean}):Promise<void>;stop(options:{path:string}):Promise<void>};
}
export interface BrowserLike {newContext(options?:{acceptDownloads?:boolean;recordVideo?:{dir:string}}):Promise<BrowserContextLike>;close():Promise<void>;version():string;browserType?():{name():string}}
export interface PlaywrightDriver {chromium:{launch(options:{headless:boolean;timeout:number}):Promise<BrowserLike>};firefox?:PlaywrightDriver['chromium'];webkit?:PlaywrightDriver['chromium']}
export interface BrowserSession extends TestExecutionContext {readonly page:BrowserPage;readonly context:BrowserContextLike}
export type BrowserTestFunction=(session:BrowserSession)=>unknown|Promise<unknown>;
export interface BrowserCase {name:string;run:BrowserTestFunction;skip?:boolean}
export interface BrowserOptions {
  browserName?:'chromium'|'firefox'|'webkit';
  /** Borrowed browser: adapter owns only new contexts/pages and never closes this browser. */
  browser?:BrowserLike;
  /** Trusted driver injection; otherwise dynamically import optional playwright. */
  driver?:PlaywrightDriver;
  timeoutMs?:number;cleanupTimeoutMs?:number;signal?:AbortSignal;
  concurrency?:number;
  beforeEach?:readonly BrowserTestFunction[];afterEach?:readonly BrowserTestFunction[];
  artifacts?:{directory:string;screenshot?:boolean;video?:boolean;trace?:boolean};
  coverage?:{expectedSources:readonly string[]};
}
const duration=(value:number,label:string)=>{if(!Number.isSafeInteger(value)||value<1||value>600000)throw new RangeError(`Invalid ${label}`);return value;};
function validate(options:BrowserOptions){
  if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('Invalid browser options');
  duration(options.timeoutMs??5000,'timeoutMs');duration(options.cleanupTimeoutMs??1000,'cleanupTimeoutMs');
  if(!Number.isSafeInteger(options.concurrency??1)||(options.concurrency??1)<1||(options.concurrency??1)>8)throw new RangeError('Invalid browser concurrency');
  if(options.browserName!==undefined&&!['chromium','firefox','webkit'].includes(options.browserName))throw new TypeError('Invalid browser name');
  if(options.signal!==undefined&&!(options.signal instanceof AbortSignal))throw new TypeError('Invalid browser signal');
  if(options.browser!==undefined&&(!options.browser||typeof options.browser!=='object'))throw new TypeError('Invalid borrowed browser');
  if(options.driver!==undefined&&(!options.driver||typeof options.driver!=='object'))throw new TypeError('Invalid browser driver');
  if(options.artifacts!==undefined&&(!options.artifacts||typeof options.artifacts!=='object'||Array.isArray(options.artifacts)))throw new TypeError('Invalid capture options');
  if(options.browser&&options.driver)throw new TypeError('Choose borrowed browser or driver');
  if(options.browser&&(['newContext','close','version'] as const).some(key=>typeof options.browser![key]!=='function'))throw new TypeError('Invalid borrowed browser');
  for(const hooks of [options.beforeEach,options.afterEach])if(hooks!==undefined&&(!Array.isArray(hooks)||hooks.length>128||hooks.some(hook=>typeof hook!=='function')))throw new TypeError('Invalid browser hooks');
  const capture=options.artifacts;
  if(capture){if(typeof capture.directory!=='string'||!capture.directory||capture.directory.length>4096||/[\x00-\x1f\x7f]/.test(capture.directory)||capture.directory.split(/[\\/]/).includes('..'))throw new TypeError('Invalid artifact directory');for(const flag of ['screenshot','video','trace'] as const)if(capture[flag]!==undefined&&typeof capture[flag]!=='boolean')throw new TypeError('Invalid capture option');}
  if(options.coverage&&(!options.coverage.expectedSources?.length))throw new TypeError('Coverage requires expected sources');
  if(options.browser&&options.coverage&&!options.browserName&&typeof options.browser.browserType!=='function')throw new TypeError('Borrowed browser coverage requires an explicit browserName');
  if(options.coverage)normalizeV8Coverage([],{runtime:'validation',expectedSources:options.coverage.expectedSources});
}
function snapshot(options:BrowserOptions):BrowserOptions {
  return {...options,...(options.beforeEach&&{beforeEach:[...options.beforeEach]}),...(options.afterEach&&{afterEach:[...options.afterEach]}),...(options.artifacts&&{artifacts:{...options.artifacts}}),...(options.coverage&&{coverage:{expectedSources:[...options.coverage.expectedSources]}})};
}
async function artifactRoot(options:BrowserOptions):Promise<string|undefined>{
  const capture=options.artifacts;if(!capture||!(capture.screenshot||capture.trace||capture.video))return undefined;
  const root=path.resolve(capture.directory);const stat=await lstat(root);
  if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(root)!==root)throw new TypeError('Artifact directory must exist without symlink components');
  return root;
}
interface Outcome {value?:unknown;error?:Error;coverage:CoverageRecord[];artifacts:NonNullable<TestResult['artifacts']>;reason?:string;cleanupFailed?:boolean}
const asError=(error:unknown)=>error instanceof Error?error:new Error(String(error));
/** Own one session. No application startup, browser install or dependency install. */
async function execute(options:BrowserOptions,run:BrowserTestFunction,root?:string):Promise<Outcome>{
  const controller=new AbortController();const abort=()=>controller.abort(options.signal?.reason??new Error('Browser test cancelled'));
  options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
  const timeout=options.timeoutMs??5000,cleanupTimeout=options.cleanupTimeoutMs??1000;
  let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort(new Error('Browser test deadline exceeded'));},timeout);
  const cleanupErrors:Error[]=[];let browser:BrowserLike|undefined,context:BrowserContextLike|undefined,page:BrowserPage|undefined;
  let active=false,tracing=false,covering=false,directory:string|undefined,runtime='browser-unknown';let browserName=options.browserName??'chromium';
  let value:unknown,failure:Error|undefined;let session:BrowserSession|undefined;
  const callbacks:(()=>void|Promise<void>)[]=[];const coverage:CoverageRecord[]=[];const artifacts:{type:'screenshot'|'trace'|'video';path:string}[]=[];
  const cancelled=new Promise<never>((_,reject)=>{const rejectAbort=()=>reject(controller.signal.reason);if(controller.signal.aborted)rejectAbort();else controller.signal.addEventListener('abort',rejectAbort,{once:true});});
  void cancelled.catch(()=>{});
  async function cleanup(action:()=>unknown|Promise<unknown>){let deadline:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([Promise.resolve().then(action),new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(new Error('Browser cleanup deadline exceeded')),cleanupTimeout);})]);}catch(error){cleanupErrors.push(asError(error));}finally{if(deadline)clearTimeout(deadline);}}
  const acquire=async<T>(pending:Promise<T>,release:(resource:T)=>Promise<void>):Promise<T>=>{
    const owned=pending.then(resource=>{if(controller.signal.aborted){void cleanup(()=>release(resource));throw controller.signal.reason;}return resource;});
    return Promise.race([owned,cancelled]);
  };
  const stage=<T>(pending:Promise<T>):Promise<T>=>Promise.race([pending,cancelled]);
  try{
    controller.signal.throwIfAborted();
    if(options.browser)browser=options.browser;
    else{
      let driver=options.driver;
      if(!driver){try{const specifier='playwright';driver=await stage(import(specifier)) as unknown as PlaywrightDriver;}catch(error){if(controller.signal.aborted)throw error;throw new EnvironmentUnavailableError('playwright',error);}}
      const launcher=driver[options.browserName??'chromium'];if(!launcher||typeof launcher.launch!=='function')throw new EnvironmentUnavailableError('browser-launcher');
      try{browser=await acquire(launcher.launch({headless:true,timeout}),resource=>resource.close());}catch(error){if(controller.signal.aborted)throw error;throw new EnvironmentUnavailableError('browser-launch',error);}
    }
    const actual=browser.browserType?.().name();
    if(actual){if(options.browserName&&actual!==options.browserName)throw new TypeError('Browser type does not match configured browserName');browserName=actual as typeof browserName;}
    runtime=`${browserName}:${browser.version()}`;
    if(root)directory=await stage(mkdtemp(path.join(root,'ztrial-')));
    context=await acquire(browser.newContext({acceptDownloads:false,...(options.artifacts?.video&&directory?{recordVideo:{dir:directory}}:{})}),resource=>resource.close());
    page=await acquire(context.newPage(),resource=>resource.close());page.setDefaultTimeout(timeout);
    session={page,context,signal:controller.signal,onCleanup(dispose){if(!active||typeof dispose!=='function'||callbacks.length>=128)throw new Error('Invalid or closed browser cleanup scope');callbacks.push(dispose);}};
    if(options.artifacts?.trace&&directory){await stage(context.tracing.start({screenshots:false,snapshots:true,sources:false}));tracing=true;}
    if(options.coverage){
      if(browserName==='chromium'&&page.coverage){await stage(page.coverage.startJSCoverage({resetOnNavigation:true,reportAnonymousScripts:false}));covering=true;}
      else coverage.push(...normalizeV8Coverage([],{runtime,expectedSources:options.coverage.expectedSources,unsupported:true}));
    }
    active=true;
    for(const hook of options.beforeEach??[])await stage(Promise.resolve().then(()=>hook(session!)));
    value=await stage(Promise.resolve().then(()=>run(session!)));
  }catch(error){failure=asError(error);}
  finally{
    clearTimeout(timer);options.signal?.removeEventListener('abort',abort);
    if(session&&active)for(const hook of options.afterEach??[])await cleanup(()=>hook(session!));
    if(covering&&page?.coverage)await cleanup(async()=>coverage.push(...normalizeV8Coverage(await page!.coverage!.stopJSCoverage(),{runtime,expectedSources:options.coverage!.expectedSources})));
    if(options.coverage&&!coverage.length)coverage.push(...normalizeV8Coverage([],{runtime,expectedSources:options.coverage.expectedSources}));
    const output=(filename:string)=>path.join(directory!,filename);
    const record=(type:'screenshot'|'trace'|'video',file:string)=>artifacts.push({type,path:path.relative(root!,file).split(path.sep).join('/')});
    if(directory&&page&&options.artifacts?.screenshot)await cleanup(async()=>{const file=output('page.png');await page!.screenshot({path:file,timeout:cleanupTimeout});record('screenshot',file);});
    if(directory&&context&&tracing)await cleanup(async()=>{const file=output('trace.zip');await context!.tracing.stop({path:file});record('trace',file);});
    active=false;controller.abort();
    for(const callback of callbacks.reverse())await cleanup(callback);
    let video:ReturnType<BrowserPage['video']>=null;
    if(options.artifacts?.video&&page)await cleanup(()=>{video=page!.video();});
    if(page)await cleanup(()=>page!.close());
    if(context)await cleanup(()=>context!.close());
    if(directory&&video)await cleanup(async()=>{const file=output('video.webm');await video!.saveAs(file);record('video',file);});
    if(browser&&!options.browser)await cleanup(()=>browser!.close());
    if(cleanupErrors.length)failure=new AggregateError([...(failure?[failure]:[]),...cleanupErrors],'Browser test or cleanup failed');
  }
  return {value,cleanupFailed:cleanupErrors.length>0,...(failure&&{error:failure}),coverage,artifacts,...(timedOut?{reason:'timeout'}:options.signal?.aborted?{reason:'cancelled'}:{})};
}
/** Awaitable adapter for an existing ztrial test. Passing scope links cancellation. */
export async function withBrowser<T>(options:BrowserOptions,run:(session:BrowserSession)=>T|Promise<T>,scope?:TestExecutionContext):Promise<{value:T;coverage:CoverageRecord[];artifacts:NonNullable<TestResult['artifacts']>}>{
  validate(options);options=snapshot(options);if(scope&&(!(scope.signal instanceof AbortSignal)||typeof scope.onCleanup!=='function'))throw new TypeError('Invalid browser test scope');if(typeof run!=='function')throw new TypeError('Browser callback is required');
  const linked=new AbortController();const signals=[options.signal,scope?.signal].filter((signal):signal is AbortSignal=>!!signal);
  const unlink:(()=>void)[]=[];for(const signal of signals){const abort=()=>linked.abort(signal.reason);if(signal.aborted)abort();else{signal.addEventListener('abort',abort,{once:true});unlink.push(()=>signal.removeEventListener('abort',abort));}}
  let pending:Promise<Outcome>|undefined;let delivered=false;
  try{scope?.onCleanup(async()=>{linked.abort();if(pending&&!delivered){const result=await pending;if(result.cleanupFailed)throw result.error;}});const root=await artifactRoot(options);pending=execute({...options,signal:linked.signal},run,root);const result=await pending;delivered=true;if(result.error)throw result.error;return {value:result.value as T,coverage:result.coverage,artifacts:result.artifacts};}
  finally{for(const remove of unlink)remove();}
}
/** Independent browser registry execution with deterministic result order and bounded workers. */
export async function runBrowserTests(cases:readonly BrowserCase[],options:BrowserOptions={}):Promise<RunSummary>{
  validate(options);options=snapshot(options);
  if(!Array.isArray(cases)||cases.length>1000||cases.some(item=>!item||typeof item.name!=='string'||!item.name.trim()||item.name.length>2048||typeof item.run!=='function'||(item.skip!==undefined&&typeof item.skip!=='boolean')))throw new TypeError('Invalid browser cases');
  cases=cases.map(item=>({...item}));
  const root=await artifactRoot(options),begin=Date.now();const results:TestResult[]=new Array(cases.length);let cursor=0;
  async function worker(){while(cursor<cases.length){const index=cursor++,item=cases[index],start=Date.now();if(item.skip){results[index]={name:item.name,status:'skipped',reason:'declared-skip',environment:'browser',durationMs:0};continue;}
    const outcome=await execute(options,item.run,root);results[index]={name:item.name,status:outcome.error?failureStatus(outcome.error):'passed',environment:'browser',durationMs:Date.now()-start,...(outcome.error&&{error:outcome.error}),reason:outcome.reason,...(options.coverage&&{coverage:outcome.coverage}),artifacts:outcome.artifacts};}}
  await Promise.all(Array.from({length:Math.min(options.concurrency??1,cases.length)},worker));
  return {passed:results.filter(result=>result.status==='passed').length,failed:results.filter(result=>result.status==='failed').length,skipped:results.filter(result=>result.status==='skipped').length,unavailable:results.filter(result=>result.status==='environment-unavailable').length,durationMs:Date.now()-begin,results};
}
export function createBrowserRunner(options:BrowserOptions={}){
  validate(options);options=snapshot(options);const cases:BrowserCase[]=[];
  const add=(name:string,run:BrowserTestFunction,skip=false)=>{if(typeof name!=='string'||!name.trim()||name.length>2048||typeof run!=='function'||cases.length>=1000)throw new TypeError('Invalid browser case');cases.push({name,run,skip});};
  return {test:(name:string,run:BrowserTestFunction)=>add(name,run),skip:(name:string,run:BrowserTestFunction=()=>{})=>add(name,run,true),runTests:()=>runBrowserTests([...cases],options),clearTests:()=>{cases.length=0;}};
}
