import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServiceScope, initializeRuntimeServices } from '../dist/bootstrap/services.js';
import { bootstrapApplication } from '../dist/bootstrap/runtime.js';

const structure = rootDir => ({ mode: 'fix', rootDir, serviceName: 'zerux', entryPointName: 'index',
  appDir: path.join(rootDir, 'app'), middlewareDirs: [], controllerDirs: [], composableDirs: [],
  pluginDirs: [], publicDirs: [], envFiles: [], outputDir: rootDir, raw: {} });
const mock = events => ({
  database: async () => ({ close: () => events.push('database') }),
  cache: async () => ({ close: () => events.push('cache') }),
  files: async () => ({ close: () => events.push('files') }),
  analytics: async () => ({ close: () => events.push('analytics') }),
  analyticsCollector: async () => ({ routes: () => [{ pattern: '/metrics/collect', handler: request => request.headers.get('authorization') === 'Bearer good' ? new Response(null, { status: 204 }) : new Response('Unauthorized', { status: 401 }) }] }),
  email: async () => ({ close: () => events.push('email') }),
});

test('Section 76: service routes reject dynamic overlaps in the same or subsequent batch without partial registration', async () => {
  const scope = createServiceScope();
  scope.addHttpRoutes('analytics', [{ pattern: '/metrics/:name', handler: () => new Response() }]);
  assert.throws(() => scope.addHttpRoutes('tags', [{pattern:'/tags/new', handler:()=>new Response()}, {pattern:'/metrics/collect',handler:()=>new Response()}]), /Conflicting/);
  assert.equal(scope.httpRoutes().length, 1);
  assert.throws(() => scope.addHttpRoutes('email', [{pattern:'/bad?x=1',handler:()=>new Response()}]), /Invalid/);
  assert.throws(() => scope.addHttpRoutes('email', [{pattern:'/metrics/:rest*',handler:()=>new Response()}]), /Conflicting/);
  await scope.close();
});

test('Section 76: booted application mounts authorized service route, preserves app paths and protects reserved endpoints from runtime plugins', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zerux-sec76-'));
  const events = [];
  await mkdir(path.join(dir, 'app'));
  await writeFile(path.join(dir, 'app', 'hello.mjs'), 'export const GET = () => ({hello:"world"});');
  const config = { server: { allowedDomains: ['localhost'] },
    analytics: { analytics: 'events', collector: { serverToken: 'TOP-SERVER-TOKEN' } },
    email: { accounts: [{ name: 'a', password: 'TOP-EMAIL-SECRET' }] },
    files: { stores: [{ name: 'media', type: 'local' }] } };
  let runtime, server;
  try {
    ({ runtime } = await bootstrapApplication(dir, 'start', config, structure(dir), mock(events)));
    assert.equal(globalThis.zeruxConfig?.email?.accounts?.[0]?.password, undefined);
    assert.equal(config.email, undefined, 'service secrets removed from request-visible configuration');
    const api = runtime.asPluginApi();
    assert.throws(() => api.addRoute({pattern:'/metrics/collect',handler:()=>new Response('override')}), /Reserved/);
    assert.throws(() => api.addRoute({pattern:'/metrics/:other',handler:()=>new Response('override')}), /Reserved/);
    assert.throws(() => api.removeRoute('/metrics/collect'), /reserved/);
    api.addRoute({pattern:'/custom',handler:()=>({newRoute:true})});
    api.variables().register('app.brand', () => 'Zerux');
    const fields = await api.variables().renderFields({subject:'Hello {{app.brand}}',html:'<b>{{user}}</b>',text:'Hi {{user}}'}, {user:'<A>'}, {escape:{html:'html'}});
    assert.deepEqual({...fields}, {subject:'Hello Zerux',html:'<b>&lt;A&gt;</b>',text:'Hi <A>'});
    server = http.createServer(runtime.createHandler());
    server.listen(0, '127.0.0.1');await once(server,'listening');
    const address = `http://127.0.0.1:${server.address().port}`;
    const request = (route, options={}) => fetch(address+route,{...options,headers:{host:'localhost',...options.headers}});
    assert.equal((await (await request('/hello')).json()).hello,'world');
    assert.equal((await (await request('/custom')).json()).newRoute,true);
    assert.equal((await request('/metrics/collect')).status,401);
    assert.equal((await request('/metrics/collect',{headers:{authorization:'Bearer good'}})).status,204);
    const manifest=JSON.stringify(runtime.toManifest());
    assert.ok(!manifest.includes('TOP-SERVER-TOKEN'));
    assert.ok(!manifest.includes('TOP-EMAIL-SECRET'));
  } finally {
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    if(runtime){await runtime.closeServices();assert.equal(runtime.variables.has('app.brand'),false);}
    await rm(dir,{force:true,recursive:true});
  }
  assert.deepEqual(events,['email','analytics','files','cache','database']);
});

test('Section 76: bad project route aborts boot and rolls back every service in reverse order', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(),'zerux-sec76-conflict-'));
  const events = [];
  await mkdir(path.join(dir,'app'));
  // Explicit plugin route collides with the reserved analytics route.
  await mkdir(path.join(dir,'plugins'));
  await writeFile(path.join(dir,'plugins','reserved.mjs'), 'export default api => api.addRoute({pattern:"/metrics/collect", handler:()=>"forbidden"});');
  const cfg={analytics:{analytics:'events',collector:{serverToken:'good'}},email:{accounts:[{}]},files:{stores:[]}};
  try {
    await assert.rejects(bootstrapApplication(dir,'start',cfg,{...structure(dir),pluginDirs:[path.join(dir,'plugins')]},mock(events)), /conflicts with application route/);
    assert.deepEqual(events,['email','analytics','files','cache','database']);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('Section 76: independent boot generations own independent variable registries', async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'zerux-sec76-generations-'));
  const events=[];
  const a=await bootstrapApplication(dir,'start',{},structure(dir),mock(events));
  const b=await bootstrapApplication(dir,'start',{},structure(dir),mock(events));
  try {
    a.runtime.variables.register('brand',()=> 'older');
    b.runtime.variables.register('brand',()=> 'newer');
    assert.equal(await a.runtime.variables.render('{{brand}}'),'older');
    assert.equal(await b.runtime.variables.render('{{brand}}'),'newer');
    await a.runtime.closeServices();
    assert.equal(await b.runtime.variables.render('{{brand}}'),'newer');
  } finally {await b.runtime.closeServices();await rm(dir,{recursive:true,force:true});}
});


test('Section 76: middleware that does not call next() cannot fall through into private application routes', async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(), 'zerux-sec76-gates-'));
  const events=[];
  await mkdir(path.join(dir,'app')); await mkdir(path.join(dir,'middleware'));
  await writeFile(path.join(dir,'app','private.mjs'), 'export const GET=()=>({secret:"private-record"});');
  await writeFile(path.join(dir,'middleware','gate.mjs'), 'export default async (ctx,next)=>ctx.req.headers["x-allow"]==="yes" ? next() : undefined;');
  await writeFile(path.join(dir,'app','missing.mjs'), 'export const middleware=["missing-auth"]; export const GET=()=>({secret:"should-not-serve"});');
  let runtime,server;
  try {
    ({runtime}=await bootstrapApplication(dir,'start',{server:{allowedDomains:['localhost']}},{...structure(dir), middlewareDirs:[path.join(dir,'middleware')]}, mock(events)));
    server=http.createServer(runtime.createHandler());server.listen(0,'127.0.0.1');await once(server,'listening');
    const base=`http://127.0.0.1:${server.address().port}`;
    const request=(route,headers={})=>fetch(base+route,{headers:{host:'localhost',...headers}});
    assert.equal((await request('/private')).status,403);
    assert.equal((await (await request('/private',{'x-allow':'yes'})).json()).secret,'private-record');
    assert.equal((await request('/missing',{'x-allow':'yes'})).status,500);
  } finally {
    if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
    await runtime?.closeServices();await rm(dir,{recursive:true,force:true});
  }
});

test('Section 76: all eight service contracts are visible at application entry and released in reverse dependency order', async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'zerux-sec76-services-'));
  const events=[];
  await writeFile(path.join(dir,'index.mjs'), `export default api => {
    const names=['database','cache','files','analytics','email','tags','reports','queue'];
    for(const name of names) if(!api.service(name)) throw Error('Missing service: '+name);
    api.addRoute({pattern:'/integration',handler:ctx=>({services:names.filter(name=>Boolean(ctx.services.get(name)))})});
  };`);
  const providers={...mock(events),
    queue: async()=>({routes:()=>[{pattern:'/operator/queue',handler:()=>new Response('queue', {status:200})}],close:()=>events.push('queue')}),
    tags: async()=>({routes:()=>[{pattern:'/tags/runtime',handler:()=>new Response('tags')}],close:()=>events.push('tags')}),
    reports: async()=>({routes:()=>[{pattern:'/reports/runtime',handler:()=>new Response('reports')}],close:()=>events.push('reports')})
  };
  const cfg={server:{allowedDomains:['localhost']},files:{stores:[]},queue:{enabled:true,redis:{host:'127.0.0.1'},queues:['jobs']},
    analytics:{analytics:'events'},tags:{enabled:true},reports:{enabled:true,authorize:()=>true},email:{accounts:[{}]}};
  let runtime,server;
  try {
    ({runtime}=await bootstrapApplication(dir,'start',cfg,structure(dir),providers));
    assert.equal(runtime.serviceScope.status().filter(s=>s.state==='ready').length,8);
    server=http.createServer(runtime.createHandler());server.listen(0,'127.0.0.1');await once(server,'listening');
    const address=`http://127.0.0.1:${server.address().port}`;
    const res=await fetch(address+'/integration',{headers:{host:'localhost'}});
    assert.equal(res.status,200);assert.equal((await res.json()).services.length,8);
    assert.equal((await fetch(address+'/operator/queue',{headers:{host:'localhost'}})).status,200);
  } finally {
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    await runtime?.closeServices();await rm(dir,{recursive:true,force:true});
  }
  assert.deepEqual(events,['email','reports','tags','analytics','queue','files','cache','database']);
});
