import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createServiceScope, initializeRuntimeServices } from '../dist/bootstrap/services.js';
import { registerServiceHttpRoutes, serviceRouteOverlaps } from '../dist/bootstrap/service-http.js';

const trackingSettings = () => ({ enabled: true, baseUrl: 'https://events.example', secret: 'development-test-secret-'.repeat(3) });
const providers = () => ({
  database: async () => null,
  cache: async () => null,
  // The default Analytics and tracking factories are exercised against the real package.
  email: async (_config, _files, _analytics, tracking) => ({ tracking, close() {} })
});

function registeredHandlers(scope, patterns = []) {
  const routes = [];
  registerServiceHttpRoutes({ addRoute(route) { routes.push(route); } }, scope, patterns);
  return routes;
}
function match(routes, path) {
  return routes.find(route => {
    const segments = route.pattern.split('/').filter(Boolean);
    const actual = path.split('/').filter(Boolean);
    return actual.length === segments.length && segments.every((part, i) => part[0] === ':' || part === actual[i]);
  });
}
async function withHttpServer(routes, callback) {
  const server = createServer((req, res) => {
    const route = match(routes, new URL(req.url, 'http://localhost').pathname);
    if (!route) { res.writeHead(404); res.end(); return; }
    const url = new URL(req.url, 'http://localhost');
    Promise.resolve(route.handler({req,res,url,method:req.method})).catch(error => {
      if (!res.headersSent) { res.statusCode = 500; res.end(String(error)); }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('Section 43: configured analytics collector and email pixel/click routes mount and stream through Node HTTP', async () => {
  const config = {
    analytics: { analytics: 'offline-connector', collector: { prefix: '/metrics', allowedOrigins: ['https://site.example'], serverToken: 'server-key' } },
    email: { accounts: [{ name: 'transactional' }], tracking: trackingSettings() }
  };
  const scope = await initializeRuntimeServices(config, process.cwd(), providers());
  try {
    assert.equal(config.analytics, undefined);
    assert.equal(config.email, undefined);
    assert.deepEqual(scope.httpRoutes().map(r => r.pattern).sort(), [
      '/_analytics/email/click/:token', '/_analytics/email/open/:token', '/metrics/collect'
    ]);
    const routes = registeredHandlers(scope);
    const email = scope.get('email');
    const html = email.tracking.instrumentHtml('<a href="https://site.example/docs">Docs</a>', {
      id: 'mail-43', account: 'transactional', message: { tracking: { enabled: true, campaign: 'section-43' } }
    });
    const pixel = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(x => x[1]).find(url => url.includes('/open/'));
    const click = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(x => x[1]).find(url => url.includes('/click/'));
    assert.ok(pixel && click);
    await withHttpServer(routes, async base => {
      const collect = base + '/metrics/collect';
      const allowed = await fetch(collect, {method:'POST',headers:{origin:'https://site.example','content-type':'application/json'},body:JSON.stringify({name:'page.view'})});
      assert.equal(allowed.status, 204, 'analytics failures do not return server errors');
      const forbidden = await fetch(collect,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
      assert.equal(forbidden.status,403);
      const server = await fetch(collect,{method:'POST',headers:{authorization:'Bearer server-key','content-type':'application/json'},body:JSON.stringify({name:'purchase',source:'server'})});
      assert.equal(server.status,204);
      const opened = await fetch(base + new URL(pixel).pathname);
      assert.equal(opened.status,200);assert.equal(opened.headers.get('content-type'),'image/gif');
      const clicked = await fetch(base + new URL(click).pathname,{redirect:'manual'});
      assert.equal(clicked.status,302);assert.equal(clicked.headers.get('location'),'https://site.example/docs');
      const invalid = await fetch(base + '/_analytics/email/open/bad');
      assert.equal(invalid.status,404);
    });
  } finally { await scope.close(); }
  assert.deepEqual(scope.httpRoutes(),[]);
});

test('Section 43: optional telemetry bootstrap failures do not break email and no tracking is implicit', async () => {
  const messages = [];
  const failed = await initializeRuntimeServices({
    analytics: {analytics:'events', collector: { allowedOrigins: ['https://site.example'] }},
    email: {accounts:[{name:'test'}],tracking:trackingSettings()}
  }, process.cwd(), {
    ...providers(), analytics: async () => { throw Error('DB offline'); },
    email: async (_config, _files, analytics, tracking) => {messages.push([analytics,tracking]); return { send: async () => 'delivered' }; }
  });
  try {
    assert.equal(messages[0][0],undefined);
    assert.ok(messages[0][1], 'signed redirect remains usable even if analytics service failed');
    assert.equal(await failed.get('email').send(),'delivered');
    assert.equal(failed.httpRoutes().length,2);
    assert.equal(failed.status().find(s=>s.name==='analytics').state,'degraded');
  } finally { await failed.close(); }
  const inactive = await initializeRuntimeServices({
    analytics: {analytics:'events', enabled:false, collector:{serverToken:'token'}},
    email: {accounts:[{name:'test'}],tracking:{...trackingSettings(),enabled:false}}
  },process.cwd(),providers());
  try {assert.equal(inactive.httpRoutes().length,0);assert.equal(inactive.get('email').tracking,undefined);}
  finally {await inactive.close();}
});

test('Section 43: invalid tracking configuration emits a warning and leaves email service usable', async () => {
  const original = console.warn; const warnings = [];
  console.warn = (...msg) => warnings.push(msg.join(' '));
  try {
    const scope = await initializeRuntimeServices({email:{accounts:[{name:'test'}],tracking:{...trackingSettings(),secret:'short'}}},process.cwd(),providers());
    try {assert.equal(scope.get('email').tracking,undefined);assert.equal(scope.httpRoutes().length,0);assert.equal(scope.status().find(s=>s.name==='email').state,'degraded');}
    finally {await scope.close();}
    assert.equal(warnings.length,1);
  } finally {console.warn=original;}
});

test('Section 43: reserved routes cannot be intercepted by static, dynamic or catch-all paths', async () => {
  assert.equal(serviceRouteOverlaps('/metrics/collect','/metrics/:name'),true);
  assert.equal(serviceRouteOverlaps('/metrics/collect','/metrics/:name*'),true);
  assert.equal(serviceRouteOverlaps('/metrics/collect','/docs/:name'),false);
  assert.equal(serviceRouteOverlaps('/metrics/collect','/metrics/{collect}'),true);
  assert.equal(serviceRouteOverlaps('/_analytics/email/click/:token','/_analytics/email/click/:other'),true);
  const scope = createServiceScope();
  scope.addHttpRoutes('analytics',[{pattern:'/metrics/collect',handler:()=>new Response(null,{status:204})}]);
  assert.throws(()=>scope.addHttpRoutes('email',[
    {pattern:'/a',handler:()=>new Response(null)},
    {pattern:'/a',handler:()=>new Response(null)}
  ]),/Duplicate/);
  assert.equal(scope.httpRoutes().length,1,'duplicate batch does not partially register routes');
  for (const conflicting of ['/metrics/collect','/metrics/:other','/metrics/:rest*']) {
    assert.throws(()=>registeredHandlers(scope,[conflicting]),/conflicts/);
  }
  const routes=registeredHandlers(scope,['/unrelated']);
  assert.equal(routes.length,1);
  assert.equal(routes[0].source,'service:analytics');
  assert.equal(routes[0].meta.streamBody,true);
  await scope.close();
});

test('Section 43: invalid tracking endpoint registration disables link instrumentation instead of emitting broken URLs', async () => {
  const warnings=[];const original=console.warn;console.warn=(...msg)=>warnings.push(msg.join(' '));
  try {
    const scope=await initializeRuntimeServices({
      analytics:{analytics:'missing', collector:{prefix:'/_analytics/email',serverToken:'token'}},
      email:{accounts:[{name:'test'}],tracking:trackingSettings()}
    },process.cwd(),{
      ...providers(),
      analyticsCollector: async()=>({routes:()=>[{pattern:'/_analytics/email/open/:token',handler:()=>new Response()}]})
    });
    try {
      assert.equal(scope.get('email').tracking,undefined);
      assert.equal(scope.httpRoutes().length,1,'collector registration persists; conflicting email routes are rejected');
      assert.equal(scope.status().find(s=>s.name==='email').state,'degraded');
    } finally {await scope.close();}
    assert.ok(warnings.some(w=>w.includes('Tracking routes unavailable')));
  } finally {console.warn=original;}
});

test('Section 43: real application bootstrap automatically exposes collector and signed email tracking routes', async () => {
  const {bootstrapApplication} = await import('../dist/bootstrap/runtime.js');
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zerux-telemetry-'));
  const emailMessages = [];
  const config = {
    server:{allowedDomains:['localhost']},
    analytics:{analytics:'missing',collector:{prefix:'/metrics',serverToken:'server-key'}},
    email:{accounts:[{name:'transactional',transport:{sendMail:async message => {emailMessages.push(message);return {messageId:'test-mail',accepted:['recipient@example.net'],rejected:[]};}}}],tracking:trackingSettings()}
  };
  const structure = {mode:'fix',rootDir,serviceName:'zerux',entryPointName:'index',appDir:null,middlewareDirs:[],controllerDirs:[],composableDirs:[],pluginDirs:[],envFiles:[],publicDirs:[],outputDir:rootDir,raw:{}};
  let runtime;
  try {
    ({runtime} = await bootstrapApplication(rootDir,'start',config,structure));
    const server=createServer(runtime.createHandler());
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const address=`http://127.0.0.1:${server.address().port}`;
    try {
      const email=runtime.serviceScope.get('email');
      const send=await email.send({from:'author@example.net',to:'recipient@example.net',subject:'Section 43',html:'<a href="https://site.example/docs">Docs</a>',text:'Docs',tracking:{enabled:true,campaign:'launch'}},{htmlMode:'trusted'});
      assert.equal(send.messageId,'test-mail');
      assert.equal(emailMessages.length,1);
      const body=emailMessages[0].html;
      assert.match(body,/\/_analytics\/email\/open\//);
      assert.match(body,/\/_analytics\/email\/click\//);
      const links=[...body.matchAll(/(?:href|src)="([^"]+)"/g)].map(x=>x[1]);
      const pixel=links.find(x=>x.includes('/open/'));
      const click=links.find(x=>x.includes('/click/'));
      const pixelResult=await fetch(address+new URL(pixel).pathname,{headers:{host:'localhost'}});
      assert.equal(pixelResult.status,200);
      const redirect=await fetch(address+new URL(click).pathname,{headers:{host:'localhost'},redirect:'manual'});
      assert.equal(redirect.status,302);
      const collected=await fetch(address+'/metrics/collect',{method:'POST',headers:{host:'localhost','content-type':'application/json',authorization:'Bearer server-key'},body:JSON.stringify({name:'page.view'})});
      assert.equal(collected.status,204);
    } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  } finally {await runtime?.closeServices();await fs.rm(rootDir,{recursive:true,force:true});}
});

test('Section 44: collector read-timeout and concurrency limits flow from runtime config to HTTP service',async()=>{
  const scope=await initializeRuntimeServices({
    analytics:{analytics:'disconnected',collector:{serverToken:'token',bodyTimeoutMs:20,maxConcurrentReads:1}}
  },process.cwd(),providers());
  try{
    const collector=scope.httpRoutes().find(r=>r.pattern.endsWith('/collect'));
    assert.ok(collector);
    const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));}});
    const request=new Request('https://events.example/_analytics/collect',{
      method:'POST',headers:{'content-type':'application/json','authorization':'Bearer token'},body:stream,duplex:'half'
    });
    const first=collector.handler(request);
    await new Promise(resolve=>setTimeout(resolve,5));
    const rejected=await collector.handler(new Request('https://events.example/_analytics/collect',{
      method:'POST',headers:{'content-type':'application/json','authorization':'Bearer token'},body:'{"name":"sample"}'
    }));
    assert.equal(rejected.status,429);
    assert.equal((await first).status,408);
  }finally{await scope.close();}
});

test('Section 45: framework tracking key rotation retains already-sent v2 and v3 links across service generations',async()=>{
  const oldSecret='old-email-tracking-secret-'.repeat(3);
  const current={id:'current_45',secret:'new-email-tracking-secret-'.repeat(3)};
  const original=await initializeRuntimeServices({email:{accounts:[{name:'marketing'}],tracking:{enabled:true,baseUrl:'https://events.example',secret:oldSecret}}},process.cwd(),providers());
  const context={id:'m45',account:'marketing',message:{tracking:{enabled:true,campaign:'october'}}};
  const linkFrom=(scope)=>{
    const body=scope.get('email').tracking.instrumentHtml('<a href="https://site.example/goods">Goods</a>',context);
    return [...body.matchAll(/href="([^"]+)"/g)][0][1];
  };
  const previouslySent=linkFrom(original);
  assert.match(previouslySent,/\/v2\./);
  await original.close();
  const rotated=await initializeRuntimeServices({email:{accounts:[{name:'marketing'}],tracking:{enabled:true,baseUrl:'https://events.example',keyRing:{current,previous:[{id:'old_44',secret:oldSecret}]},acceptLegacyHmac:false}}},process.cwd(),providers());
  try{
    const routes=registeredHandlers(rotated);
    const replacement=linkFrom(rotated);
    assert.match(replacement,/\/v3\.current_45\./);
    await withHttpServer(routes,async base=>{
      for(const url of [previouslySent,replacement]){
        const response=await fetch(base+new URL(url).pathname,{redirect:'manual'});
        assert.equal(response.status,302);
        assert.equal(response.headers.get('location'),'https://site.example/goods');
      }
    });
  }finally{await rotated.close();}
  // An invalid optional ring is fail-soft, not a reason to block delivery.
  const bad=await initializeRuntimeServices({email:{accounts:[{name:'marketing'}],tracking:{enabled:true,baseUrl:'https://events.example',keyRing:{current:{id:'bad.id',secret:oldSecret}}}}},process.cwd(),providers());
  try{assert.equal(bad.get('email').tracking,undefined);assert.deepEqual(bad.httpRoutes(),[]);}
  finally{await bad.close();}
});

test('Section 46: managed one-click unsubscribe route enforces consent for marketing mail across HTTP requests',async()=>{
  const {createMemoryConsentStore,createEmailPreferenceService}=await import('../../@zeruxjs/email/dist/index.js');
  const store=createMemoryConsentStore();
  const preferencesConfig={enabled:true,baseUrl:'https://mail.example',secret:'section-46-shared-unsubscribe-secret-'.repeat(3),store};
  const sent=[];
  const scope=await initializeRuntimeServices({email:{accounts:[{name:'news',defaults:{from:'news@example.com'},transport:{async sendMail(content){sent.push(content);return {messageId:String(sent.length),accepted:content.to};}}}],preferences:preferencesConfig}},process.cwd(),{
    database:async()=>null,cache:async()=>null
  });
  try{
    const endpoint=scope.httpRoutes().find(r=>r.pattern==='/_zerux/email/unsubscribe/:token');
    assert.ok(endpoint,'service route should be registered as email endpoint');
    const external=createEmailPreferenceService(preferencesConfig);
    await assert.rejects(scope.get('email').send({to:'reader@example.com',subject:'Campaign',text:'Hello',purpose:'marketing'}),{code:'EMAIL_CONSENT_REQUIRED'});
    await external.subscribe('reader@example.com',{source:'form',proof:'verified-event'});
    await scope.get('email').send({to:'reader@example.com',subject:'Campaign',text:'Hello',purpose:'marketing'});
    const header=sent[0].headers['List-Unsubscribe'];
    const link=header.slice(1,-1);
    assert.match(link,/https:\/\/mail\.example\/_zerux\/email\/unsubscribe\//);
    assert.doesNotMatch(link,/reader@example.com/);
    const routes=registeredHandlers(scope);
    await withHttpServer(routes,async base=>{
      const url=base+new URL(link).pathname;
      const get=await fetch(url);assert.equal(get.status,200);
      assert.equal(await external.isSubscribed('reader@example.com'),true,'GET scanner must not unsubscribe');
      const res=await fetch(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'List-Unsubscribe=One-Click'});
      assert.equal(res.status,200);
    });
    assert.equal(await external.isSubscribed('reader@example.com'),false);
    await assert.rejects(scope.get('email').send({to:'reader@example.com',subject:'Later',text:'No',purpose:'marketing'}),{code:'EMAIL_CONSENT_REQUIRED'});
    assert.equal(sent.length,1);
  }finally{await scope.close();}
});

test('Section 46: invalid preference route or configuration cannot silently enable marketing sends',async()=>{
  const prefs={enabled:true,baseUrl:'https://mail.example',secret:'preference-secret-for-integration-'.repeat(3)};
  await assert.rejects(initializeRuntimeServices({email:{accounts:[{name:'news'}],preferences:{...prefs,secret:'short'}}},process.cwd(),providers()),/32 bytes/);
  const conflict=initializeRuntimeServices({email:{accounts:[{name:'news'}],preferences:prefs,tracking:trackingSettings()}},process.cwd(),{
    ...providers(),
    emailTracking:async()=>({routes:()=>[{pattern:'/_zerux/email/unsubscribe/:token',handler:()=>new Response()}]})
  });
  await assert.rejects(conflict,/Duplicate service HTTP route/);
});
