/** Node test entry; no application server or live provider is started. */
import { test } from 'node:test';
/** Local assertions over synthetic cryptographic/persistence fixtures. */
import assert from 'node:assert/strict';
/** Owned temporary fixture file operations; no user files are read or deleted. */
import fs from 'node:fs';
/** Native path operations for owned fixture roots. */
import path, { dirname } from 'node:path';
/** Native temporary-directory lookup, not application/user state. */
import os from 'node:os';
/** Local explicit-argument pack/compile runner; no shell interpolation. */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
/** CommonJS bridge retained for the packed consumer's intentional require check. */
const require = createRequire(import.meta.url);
test('packed provider API and JWT subpath work together without source aliases or optional browser libraries', () => {
  /** Owned temporary fixture root removed in finally. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-public-'));
  /** Explicit repository root for local package archives and compiler resolution. */
  const root = path.resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../..'
  );
  try {
    /** Archive only the explicitly named local package for an isolated offline consumer.
     * @param {string} folder - Explicit local package root.
     * @returns {string} Owned local archive path; no arbitrary package discovery or execution.
     */
    function pack(folder: string): string {
      /** Actual verified identity/state receipt checked by the following assertions. */
      const result = JSON.parse(
        execFileSync(
          'npm',
          [
            'pack',
            '--ignore-scripts',
            '--json',
            '--cache',
            path.join(dir, 'cache'),
            '--pack-destination',
            dir,
          ],
          { cwd: folder, encoding: 'utf8' }
        )
      );
      return path.join(
        dir,
        (Array.isArray(result) ? result[0] : Object.values(result)[0]).filename
      );
    }
    /** Explicit local tarball dependencies for the isolated public consumer. */
    const deps = {
      '@zeruxjs/auth': `file:${pack(path.join(root, 'packages/@zeruxjs/auth'))}`,
      '@zeruxjs/security': `file:${pack(path.join(root, 'packages/@zeruxjs/security'))}`,
      jose: `file:${pack(path.dirname(require.resolve('jose/package.json')))}`,
    };
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ type: 'module', private: true, dependencies: deps })
    );
    execFileSync(
      'npm',
      [
        'install',
        '--offline',
        '--omit=optional',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--cache',
        path.join(dir, 'cache'),
      ],
      { cwd: dir, stdio: 'pipe' }
    );
    fs.writeFileSync(
      path.join(dir, 'consumer.ts'),
      `import {createProviderLogin,createMemoryProviderLoginStore,type LoginProvider} from '@zeruxjs/auth';
import {createJwtSigner,createJwtVerifier} from '@zeruxjs/security/jwt';
const key={kty:'oct',kid:'fixture',alg:'HS256' as const,k:'A'.repeat(43)};
const signer=createJwtSigner({key,kid:'fixture',algorithm:'HS256',issuer:'https://issuer.example',audience:'client',type:'JWT'});
const verifier=createJwtVerifier({keys:[key],policy:{algorithms:['HS256'],issuer:'https://issuer.example',audience:'client',type:'JWT',requiredClaims:['exp'],subject:'required',jti:'optional'}});
try {const token=await signer.sign({scope:'read'},{subject:'fixture',ttlSeconds:60});if((await verifier.verify(token)).sub!=='fixture')throw Error('JWT failed');}finally{await signer.close();await verifier.close();}
const provider:LoginProvider={id:'example',profile:'custom',protocol:'oidc',label:'Example',issuer:'https://issuer.example',authorizationEndpoint:'https://issuer.example/auth',tokenEndpoint:'https://issuer.example/token',userInfoEndpoint:'https://issuer.example/user',jwksUrl:'https://issuer.example/keys',allowedUrls:['https://issuer.example/auth','https://issuer.example/token','https://issuer.example/user','https://issuer.example/keys'],redirectUris:['https://app.example/callback'],scopes:['openid'],clientId:'fixture',tokenAuthentication:'none',mapProfile:value=>({subject:typeof value.sub==='string'?value.sub:''})};
let network=0;const store=createMemoryProviderLoginStore();const login=createProviderLogin({providers:[provider],store,bindingKey:new Uint8Array(32),authorizeFresh:async()=>false,transport:async()=>{network++;throw Error('No configured live transport');}});
try {const result=await login.begin('example',{tenant:'fixture',session:'fixture-session'},'https://app.example/callback');if(!new URL(result.url).searchParams.has('nonce')||network)throw Error('Flow not inert');}finally{await login.close();store.clear();}
`
    );
    execFileSync(
      process.execPath,
      [
        path.join(root, 'node_modules/typescript/bin/tsc'),
        '--strict',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--skipLibCheck',
        'consumer.ts',
      ],
      { cwd: dir, stdio: 'pipe' }
    );
    execFileSync(process.execPath, ['consumer.js'], {
      cwd: dir,
      stdio: 'pipe',
    });
    assert.equal(
      fs.existsSync(path.join(dir, 'node_modules/@zeruxjs/auth/src')),
      false
    );
    assert.equal(
      fs.existsSync(path.join(dir, 'node_modules/@zeruxjs/security/src')),
      false
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
