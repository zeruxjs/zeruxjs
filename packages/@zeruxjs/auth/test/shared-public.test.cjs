const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
test('packed public declarations and imports run without source resolution', () => {
    const directory = mkdtempSync(join(tmpdir(), 'auth-public-'));
    const cwd = resolve(__dirname, '..');
    try {
        const packedResult = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--cache', join(directory, 'cache'), '--pack-destination', directory], { cwd, encoding: 'utf8' }));
        const packed = Array.isArray(packedResult) ? packedResult[0] : packedResult['@zeruxjs/auth'];
        writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
        execFileSync('npm', ['install', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--cache', join(directory, 'cache'), join(directory, packed.filename)], { cwd: directory, stdio: 'pipe' });
        writeFileSync(join(directory, 'consumer.ts'), `import { createMemoryAuthPersistence, createSharedAuth, type AuthPersistence, createPasskeyManager, createMemoryPasskeyStore, type PasskeyManagerOptions, type ClientCertificateIdentityAdapter, type EnterpriseSsoIdentityAdapter, createProviderLogin, createMemoryProviderLoginStore } from '@zeruxjs/auth';
const store: AuthPersistence = createMemoryAuthPersistence();
const auth = createSharedAuth({ store, indexKey: new Uint8Array(32), keys: [{ id: 'fixture', key: new Uint8Array(32) }], activeKeyId: 'fixture', authorizeFresh: async () => false });
const account = {tenant: 'example', account: 'user-1'};
try {
 const issued = await auth.issueSession(account, {device: 'laptop', scopes: ['posts:read'], ttlMs: 3600000});
 const session = await auth.verifySession(account, issued.token, 'posts:read');
 if (!session || session.scopes[0] !== 'posts:read') throw Error('Public import failed');
 // @ts-expect-error key material is not public session metadata
 session.digest;
} finally { await auth.close(); }
function configurePasskeys(options: PasskeyManagerOptions) { return createPasskeyManager(options); }
const passkeys = configurePasskeys({store:createMemoryPasskeyStore(),rpId:'example.test',rpName:'Example',origins:['https://example.test'],bindingKey:new Uint8Array(32),authorizeFresh:async()=>true});
try {
 await passkeys.beginRegistration(account,'session','Alice');
 throw Error('Optional dependency unexpectedly present');
} catch (error) {
 if (!(error instanceof Error) || error.message !== 'PASSKEY_UNAVAILABLE') throw error;
} finally { await passkeys.close(); }
const providerStore=createMemoryProviderLoginStore();
const login=createProviderLogin({store:providerStore,bindingKey:new Uint8Array(32),authorizeFresh:async()=>false,transport:async()=>Response.json({access_token:'fixture',token_type:'Bearer',id_token:'fixture.fixture.fixture'}),providers:[{id:'example',profile:'custom',protocol:'oidc',label:'Example',issuer:'https://issuer.example',authorizationEndpoint:'https://issuer.example/auth',tokenEndpoint:'https://issuer.example/token',userInfoEndpoint:'https://issuer.example/user',jwksUrl:'https://issuer.example/keys',allowedUrls:['https://issuer.example/auth','https://issuer.example/token','https://issuer.example/user','https://issuer.example/keys'],redirectUris:['https://app.example/callback'],scopes:['openid'],clientId:'fixture',tokenAuthentication:'none',mapProfile:()=>({subject:'fixture'})}]});
try {
 const started=await login.begin('example',{tenant:'fixture',session:'session'},'https://app.example/callback');
 const callback=new URLSearchParams({state:new URL(started.url).searchParams.get('state')!,code:'fixture'});
 try {await login.complete('example',{tenant:'fixture',session:'session'},callback);throw Error('Optional JWT dependency unexpectedly present');}
 catch(error){if(!(error instanceof Error)||error.message!=='LOGIN_UNAVAILABLE')throw error;}
}finally{await login.close();providerStore.clear();}
`);
        const compiler = resolve(cwd, '../../../node_modules/typescript/bin/tsc');
        execFileSync(process.execPath, [compiler, '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--skipLibCheck', 'consumer.ts'], { cwd: directory, stdio: 'pipe' });
        execFileSync(process.execPath, ['consumer.js'], { cwd: directory, stdio: 'pipe' });
        assert.ok(packed.files.some(file => file.path === 'dist/shared-auth.d.ts'));
        assert.ok(!packed.files.some(file => file.path.startsWith('src/')));
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
