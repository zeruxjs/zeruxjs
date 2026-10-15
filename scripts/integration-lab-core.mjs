/** Offline-safe Section 83 release-evidence model. No external dependencies. */
import {resolve, sep, dirname} from 'node:path';
import {lstatSync, realpathSync} from 'node:fs';

const suites = Object.freeze([
 {id:'source',kind:'offline',description:'Isolated source, build order, lock and contracts',command:['scripts/verify-source-workspace.mjs'],timeout:180000},
 {id:'sqlite',kind:'offline',description:'Real SQLite persisted analytics, tags, reports, campaigns and migration flows',command:['--test','tests/integration/analytics-sqlite.test.mjs','tests/integration/tags-sqlite.test.mjs','tests/integration/reports-sqlite.test.mjs','tests/integration/campaign-sqlite.test.mjs','tests/integration/analytics-job-sqlite.test.mjs','tests/integration/analytics-reconciliation-sqlite.test.mjs','tests/section74-database-engine-parity.test.mjs'],timeout:240000},
 {id:'auth',kind:'offline',description:'Local auth/security tenant and token contracts',command:['--test','packages/@zeruxjs/auth/test/auth.test.cjs','packages/@zeruxjs/security/test/security.test.cjs'],timeout:90000},
 {id:'pipeline',kind:'offline',description:'Real SQLite Auth to Analytics/Tags/Reports/Email suppression pipeline',command:['--test','tests/integration/section83-package-pipeline.test.mjs'],timeout:120000},
 {id:'content',kind:'offline',description:'Local content/file/asset/search/document workflow',command:['--test','tests/integration/section80-content-workflow.test.mjs'],timeout:120000},
 {id:'pg',kind:'live',description:'Real PostgreSQL connector parity',env:['ZX_TEST_PG_URL'],probe:'pg',command:['--test','--test-name-pattern=PostgreSQL real-engine parity','tests/section74-database-engine-parity.test.mjs'],timeout:90000},
 {id:'mysql',kind:'live',description:'Real MySQL connector parity',env:['ZX_TEST_MYSQL_DB','ZX_TEST_MYSQL_USER'],probe:'mysql',command:['--test','--test-name-pattern=MySQL real-engine parity','tests/section74-database-engine-parity.test.mjs'],timeout:90000},
 {id:'mongo',kind:'live',description:'Real MongoDB connector parity',env:['ZX_TEST_MONGO_URI'],probe:'mongo',command:['--test','--test-name-pattern=MongoDB real-engine parity','tests/section74-database-engine-parity.test.mjs'],timeout:90000},
 {id:'redis-cache',kind:'live',description:'Real Redis tenant isolation',env:['CACHE_REDIS_URL'],probe:'redis',command:['--test','--test-name-pattern=LIVE Redis: two tenants','packages/@zeruxjs/cache-redis/test/section75-live-redis.test.mjs'],timeout:90000},
 {id:'redis-queue',kind:'live',description:'Real BullMQ multi-worker, delayed, retry and failure paths',env:['QUEUE_REDIS_URL'],probe:'redis',command:['--test','--test-name-pattern=LIVE Redis:','packages/@zeruxjs/queue/test/section75-live-certification.test.mjs'],timeout:150000},
 {id:'redis-cluster',kind:'live',description:'Real Redis Cluster cache and BullMQ hash slots',env:['QUEUE_REDIS_CLUSTER_NODES','CACHE_REDIS_CLUSTER_NODES'],command:['--test','--test-name-pattern=LIVE Redis Cluster:','packages/@zeruxjs/cache-redis/test/section75-live-redis.test.mjs','packages/@zeruxjs/queue/test/section75-live-certification.test.mjs'],timeout:150000},
 {id:'s3',kind:'live',description:'Real S3-compatible binary object round-trip and tenant prefix isolation',env:['LAB_S3_ENDPOINT','LAB_S3_BUCKET','LAB_S3_ACCESS_KEY','LAB_S3_SECRET_KEY'],probe:'s3',command:['--test','tests/integration/section83-s3-live.test.mjs'],timeout:90000},
 {id:'smtp',kind:'live',description:'Real SMTP TLS credential handshake, no mail delivered by default',env:['ZERUX_TEST_LIVE_SMTP','ZERUX_TEST_SMTP_HOST','ZERUX_TEST_SMTP_USER','ZERUX_TEST_SMTP_PASSWORD'],probe:'smtp',command:['--test','--test-name-pattern=opt-in real SMTP TLS','packages/@zeruxjs/email/test/smtp-live-optional.test.mjs'],timeout:75000},
 {id:'imap',kind:'live',description:'Real IMAP TLS read-only folder/auth verification',env:['ZERUX_TEST_LIVE_INBOUND','ZERUX_TEST_IMAP_HOST','ZERUX_TEST_IMAP_USER','ZERUX_TEST_IMAP_PASSWORD'],probe:'imap',command:['--test','--test-name-pattern=optional live IMAP TLS','packages/@zeruxjs/email/test/inbound-live-optional.test.mjs'],timeout:75000},
 {id:'pop3',kind:'live',description:'Real POP3 TLS read-only auth verification',env:['ZERUX_TEST_LIVE_INBOUND','ZERUX_TEST_POP3_HOST','ZERUX_TEST_POP3_USER','ZERUX_TEST_POP3_PASSWORD'],probe:'pop3',command:['--test','--test-name-pattern=optional live POP3 TLS','packages/@zeruxjs/email/test/inbound-live-optional.test.mjs'],timeout:75000},
 {id:'browser',kind:'live',description:'Real Chromium accessibility fixture, not a mock browser',env:['RUN_BROWSER_TESTS'],command:['--test','tests/browser/section78.test.mjs'],timeout:80000}
]);
export const labSuites = suites;
export const suiteIds = new Set(suites.map(s=>s.id));

export function parseLabArgs(argv){
 const state={mode:'offline',required:[],selected:[],report:undefined,dryRun:false,build:false};
 for(const arg of argv){
  if(arg==='--offline'||arg==='--live'||arg==='--all')state.mode=arg.slice(2);
  else if(arg==='--build')state.build=true;
  else if(arg==='--dry-run')state.dryRun=true;
  else if(arg.startsWith('--only='))state.selected.push(...arg.slice(7).split(','));
  else if(arg.startsWith('--require='))state.required.push(...arg.slice(10).split(','));
  else if(arg.startsWith('--report='))state.report=arg.slice(9);
  else throw new Error(`Invalid lab option: ${arg.slice(0,100)}`);
 }
 if(state.selected.some(id=>!suiteIds.has(id))||state.required.some(id=>!suiteIds.has(id)))throw new Error('Unknown suite identifier');
 if(state.selected.some(x=>!x)||state.required.some(x=>!x))throw new Error('Empty suite identifier');
 if(state.report!==undefined && (!state.report||state.report.includes('\0')))throw new Error('Invalid report path');
 if(state.selected.length && state.required.some(x=>!state.selected.includes(x)))throw new Error('Required suite must also be selected by --only');
 state.selected=[...new Set(state.selected)];state.required=[...new Set(state.required)];
 return state;
}
export function suitesFor(options){
 const accepted=options.selected.length?options.selected:new Set(options.mode==='offline'?['source','auth','sqlite','pipeline','content']:options.mode==='live'?suites.filter(s=>s.kind==='live').map(s=>s.id):suites.map(s=>s.id));
 return suites.filter(s=>accepted.includes?.(s.id)||accepted.has?.(s.id));
}
export function suiteReadiness(suite,env){
 const missing=(suite.env??[]).filter(key=>!env[key]);
 // Explicit opt-ins must equal 1, rather than treating arbitrary strings as consent.
 for(const key of ['ZERUX_TEST_LIVE_SMTP','ZERUX_TEST_LIVE_INBOUND','RUN_BROWSER_TESTS'])if(suite.env?.includes(key)&&env[key]&&env[key]!=='1')missing.push(key);
 return {ready:missing.length===0,missing};
}
export function parseTapSummary(out){
 const value=(field)=>Number([...out.matchAll(new RegExp(`^\\s*# ${field} (\\d+)\\s*$`,'gm'))].at(-1)?.[1]??NaN);
 const pass=value('pass'),fail=value('fail'),skip=value('skipped'),tests=value('tests');
 if(![pass,fail,skip,tests].every(Number.isSafeInteger))return null;
 return {tests,passed:pass,failed:fail,skipped:skip};
}
export function testResult(exitCode,tap){
 if(exitCode!==0)return 'failed';
 if(!tap||tap.tests<1||tap.passed<1||tap.failed>0)return 'failed';
 return 'passed';
}
export function overallStatus(rows,required=[]){
 if(!rows.length)return 'failed';
 if(rows.some(r=>r.status==='failed'||(required.includes(r.id)&&r.status!=='passed')))return 'failed';
 if(rows.every(r=>r.status==='skipped'||r.status==='planned'||r.status==='blocked'))return 'incomplete';
 if(rows.every(r=>r.status==='passed'))return 'passed';
 return 'partial';
}
/** Keep reports in the workspace even for absolute inputs or symlink ancestors.
 * Never follow a symlink for a report file: reports may contain sensitive metadata.
 */
export function safeReportPath(root,requested){
 if(!requested)return undefined;
 const base=realpathSync(resolve(root));
 const target=resolve(base,requested);
 if(target===base||!target.startsWith(base+sep))throw new Error('Report path escapes workspace');
 let parent=dirname(target);
 while(parent!==base){
  const stat=lstatSync(parent,{throwIfNoEntry:false});
  if(stat?.isSymbolicLink())throw new Error('Report path escapes workspace via symlink');
  if(stat&&!stat.isDirectory())throw new Error('Report ancestor is not a directory');
  const next=dirname(parent);
  if(next===parent)throw new Error('Report path escapes workspace');
  parent=next;
 }
 if(lstatSync(target,{throwIfNoEntry:false})?.isSymbolicLink())throw new Error('Report path is a symlink');
 return target;
}
