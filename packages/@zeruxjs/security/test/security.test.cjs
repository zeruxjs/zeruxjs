const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCsrfProtection, evaluateCors, createSecurityHeaders, createRateLimiter, serializeCookie, sanitizeRelativeAssetPath, buildContentSecurityPolicy } = require('../dist/index.js');
test('CSRF tokens bind session, time, and secret', () => {
 let now = 1000000; const a = createCsrfProtection({secret:'x'.repeat(32), ttlSeconds:30, now:()=>now});
 const token = a.issue('sessionA'); assert.equal(a.verify(token,'sessionA'),true);
 assert.equal(a.verify(token,'sessionB'),false); assert.equal(a.verify(token.slice(0,-4)+'abcd','sessionA'),false);
 now += 31_000; assert.equal(a.verify(token,'sessionA'),false);
});
test('CORS preflight validates origin, method and headers',()=>{
 const config={origins:['https://a.example'],credentials:true, headers:['Content-Type'],methods:['POST']};
 assert.equal(evaluateCors('https://a.example',config,{method:'POST',headers:'Content-Type'}).status,204);
 assert.equal(evaluateCors('https://evil.example',config).allowed,false);
 assert.equal(evaluateCors('https://a.example',config,{method:'DELETE'}).allowed,false);
 assert.equal(evaluateCors('https://a.example',config,{method:'POST',headers:'Authorization'}).allowed,false);
});
test('security headers, cookie prefixes and host path containment',()=>{
 assert.equal(createSecurityHeaders({hsts:true},false)['strict-transport-security'],undefined);
 assert.equal(createSecurityHeaders({hsts:true},true)['strict-transport-security'].includes('max-age='),true);
 assert.throws(()=>serializeCookie('__Host-auth','x',{secure:true}),/__Host-/);
 assert.ok(serializeCookie('__Host-auth','x',{secure:true,path:'/'}).includes('HttpOnly'));
 assert.equal(sanitizeRelativeAssetPath('C:\\Windows\\secret'),null);
 assert.throws(()=>buildContentSecurityPolicy('a'.repeat(24),{frameAncestors:['evil; script-src *']}));
});
test('bounded limiter resets after expiry',()=>{
 let now=100; const limiter=createRateLimiter({ max:2, windowMs:1000, now:()=>now });
 assert.equal(limiter.check('ip').allowed,true); assert.equal(limiter.check('ip').allowed,true); assert.equal(limiter.check('ip').allowed,false);
 now+=1001; assert.equal(limiter.check('ip').allowed,true);
});
test('security regression: bounded nonce, encoded traversals, and cookie control characters',()=>{
 const {createNonce} = require('../dist/index.js');
 assert.throws(()=>createNonce(2**24),/nonce size/i);
 assert.throws(()=>createNonce(0),/nonce size/i);
 assert.ok(createNonce(16).length >= 22);
 for (const path of ['../secret','..\\secret','sub/%2e%2e%2fsecret','sub/%5csecret','data:evil','folder/a%2F..','folder\\..\\secret'])
   assert.equal(sanitizeRelativeAssetPath(path),null,path);
 assert.equal(sanitizeRelativeAssetPath('assets/icons/logo.svg'),'assets/icons/logo.svg');
 assert.throws(()=>serializeCookie('auth','ok',{path:'/ok\u0001evil'}),/cookie path/);
});
test('security parsers remain bounded and reject malicious randomized input',()=>{
 const {createNonce} = require('../dist/index.js');
 let s=1234567;
 for(let i=0;i<2500;i++) {
   s=(Math.imul(s,1664525)+1013904223)>>>0;
   const candidates=['../secret', '%2E%2E%2fprivate', `safe/${s.toString(36)}`, 'x\0y', String.fromCharCode(s%32)+'a'];
   const item=candidates[s%5];
   const result=sanitizeRelativeAssetPath(item);
   if(result!==null) assert.ok(!result.includes('\0') && !result.includes('..'));
   assert.ok(createNonce(16).length>=22);
 }
});
