import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readPublicRouteManifest} from '../dist/navigation-manifest.js';
import {readBuildFile} from '../dist/commands/build-paths.js';

test('route validation rejects ambiguous long segments without changing valid dynamic routes', {timeout: 1000}, () => {
  const manifest = pattern => ({version: 1, basePath: '/', boundaries: {}, routes: [{id:'route', pattern, layouts: []}]});
  assert.equal(readPublicRouteManifest(manifest('/docs/:slug')).routes[0].parameters[0].name, 'slug');
  assert.throws(() => readPublicRouteManifest(manifest('/' + '-'.repeat(1900) + '!')), /NAVIGATION_ROUTE_INVALID/);
  assert.equal(readPublicRouteManifest(manifest('/')).routes[0].pattern, '/');
});
test('build reads inspect the opened file, reject leaf links and enforce byte budgets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codeql-build-'));
  try {
    const file = path.join(root, 'data'); await writeFile(file, 'known bytes');
    assert.equal((await readBuildFile(file, 32)).toString(), 'known bytes');
    await assert.rejects(readBuildFile(file, 4), /oversized/);
    await symlink(file, path.join(root, 'link'));
    await assert.rejects(readBuildFile(path.join(root, 'link'), 32));
    await assert.rejects(readBuildFile(root, 32));
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('theme script encodes script terminators and does not treat replacement tokens as HTML', async () => {
  const {createApplicationLifecycle}=await import('zeruxjs');
  const {createServer}=await import('node:http');
  const {once}=await import('node:events');
  const {JSDOM}=await import('jsdom');
  const root=await mkdtemp(path.join(tmpdir(),'codeql-theme-'));
  let app,server;
  try {
    app=await createApplicationLifecycle({rootDir:root,config:{theme:{cookieName:'theme</script><script>forged()</script>$&'}},providers:{database:async()=>null,cache:async()=>null}});
    app.runtime().asPluginApi().addRoute({pattern:'/',handler:()=>'<html style="color-scheme: light; font-family: sans-serif"><head></head><body><h1>Known content</h1></body></html>'});
    server=createServer((req,res)=>void app.handle(req,res).catch(()=>res.destroy()));
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const html=await(await fetch(`http://127.0.0.1:${server.address().port}`)).text();
    const dom=new JSDOM(html);
    try {
      assert.equal(dom.window.document.scripts.length,1);
      assert.equal(dom.window.document.querySelector('h1').textContent,'Known content');
      assert.match(dom.window.document.scripts[0].textContent,/\\u003c/);
      assert.equal(dom.window.document.documentElement.style.colorScheme,'light');
    } finally {dom.window.close();}
  } finally {
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    await app?.close();await rm(root,{recursive:true,force:true});
  }
});
