import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevtoolsDocumentPolicy, injectDevClient, registerSharedDevApp } from 'zforge';
import { renderDocument } from '../dist/components/document.js';

test('development framing grants exact configured origins, production ignores them', () => {
    const dev = createDevtoolsDocumentPolicy({mode:'development',frameAncestors:['http://localhost:3000']});
    assert.ok(dev.headers['content-security-policy'].includes('http://localhost:3000'));
    assert.equal(dev.headers['x-frame-options'], undefined);
    const prod = createDevtoolsDocumentPolicy({mode:'production',frameAncestors:['http://localhost:3000']});
    assert.ok(prod.headers['content-security-policy'].includes("frame-ancestors 'none'"));
    assert.ok(!prod.headers['content-security-policy'].includes('localhost'));
    assert.equal(prod.headers['x-frame-options'], 'DENY');
    assert.equal(prod.headers['cross-origin-embedder-policy'], 'require-corp');
    const html = renderDocument({title:'App',content:'',config:{},nonce:prod.nonce});
    assert.ok(html.includes(`nonce="${prod.nonce}"`));
    assert.notEqual(createDevtoolsDocumentPolicy().nonce, prod.nonce);
    assert.throws(() => createDevtoolsDocumentPolicy({mode:'development',frameAncestors:['https://ok.example\r\nX:yes']}));
});

test('manual client injection uses only an explicit response-owner nonce', () => {
    const security = createDevtoolsDocumentPolicy();
    const options = {routeName:'app', serviceName:'zdev', devServerUrl:'http://localhost:9000',devPortLessAlias:{value:null},nonce:security.nonce};
    const output = injectDevClient('<body></body>',options);
    assert.ok(output.includes(`nonce="${security.nonce}"`));
    assert.throws(() => injectDevClient('<body></body>', {...options,nonce:'bad\r\nnonce'}));
});

test('invalid registration framing rejects before registry or listener acquisition', async () => {
    await assert.rejects(registerSharedDevApp({appName:'invalid-framing',appPort:3000,rootDir:process.cwd(),devtools:{modules:[],frameAncestors:['https://allowed.example\r\nInjected: true']}}), TypeError);
});
