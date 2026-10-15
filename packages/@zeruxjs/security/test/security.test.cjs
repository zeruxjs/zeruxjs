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
