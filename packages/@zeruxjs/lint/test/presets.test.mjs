import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ESLint, Linter } from 'eslint';
import { createPackageConfig, createApplicationConfig } from '@zeruxjs/lint/presets';
import packagePreset from '@zeruxjs/lint/presets/package';
import strictPreset from '@zeruxjs/lint/presets/application';
const strict=await createApplicationConfig({environment:'browser'});
const light=createPackageConfig({environment:'browser'});
const verify=(text,config=strict,filename='fixture.ts')=>new Linter().verify(text,config,{filename}).filter(item=>item.ruleId?.startsWith('zerux/'));
const rules=(text,config=strict,filename)=>verify(text,config,filename).map(item=>item.ruleId);
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'zerux-lint-preset-'));

test('explicit flat entries share error-level security policy; importing presets performs no lint',()=>{
 assert.ok(Array.isArray(packagePreset));assert.ok(Array.isArray(strictPreset));
 for(const config of [light,strict]){
  const messages=rules(`'use client';import 'node:fs';import{defineService}from'zeruxjs';defineService({publicFields:['clientSecret']});`,config);
  assert.ok(messages.includes('zerux/client-server-import'));assert.ok(messages.includes('zerux/public-service-config'));
  assert.ok(verify(`'use client';import 'node:fs';`,config).every(item=>item.severity===2));
 }
 assert.throws(()=>createPackageConfig({environment:'anything'}),/preset options/);
});

test('client boundaries honor actual leading directives, type-only imports and shadowed require',()=>{
 for(const source of [`'use strict';'use client';import fs from 'fs';`, `'use client';export * from 'zlocale/node';`, `'use client';import('@zeruxjs/validator/http');`, `'use client';import fs = require('node:fs');`])assert.ok(rules(source).includes('zerux/client-server-import'));
 assert.ok(rules(`import 'node:crypto';`,strict,'component.client.ts').includes('zerux/client-server-import'));
 for(const source of [`import 'node:fs';`, `const x=1;'use client';import 'node:fs';`, `'use client';import type {Stats} from 'node:fs';`, `'use client';import {type Stats} from 'node:fs';`, `'use client';import {escapeHtmlText} from '@zeruxjs/security/encoding';`, `'use client';function require(x){return x};require('node:fs');`])assert.ok(!rules(source).includes('zerux/client-server-import'),source);
});

test('cleanup rule reports only discarded known handles, with scoped imports and native alternatives',()=>{
 for(const source of [`import{watchDirectory as watch}from'zlook';watch('.');`, `import*as look from'zlook';look.watchDirectory('.');`, `import{watchZuix}from'zuixs/node';void watchZuix('.');`, `setInterval(()=>{},1000);`])assert.ok(rules(source).includes('zerux/cleanup-ownership'),source);
 for(const source of [`import{watchDirectory}from'zlook';const handle=watchDirectory('.');handle.close();`, `import{watchDirectory}from'zlook';function create(){return watchDirectory('.')}`, `import{watchDirectory}from'zlook';own(watchDirectory('.'));`, `import{watchDirectory}from'zlook';function f(watchDirectory){watchDirectory('.')}`, `const id=setInterval(()=>{},1000);clearInterval(id);`, `function createI18n(){};createI18n();`])assert.ok(!rules(source).includes('zerux/cleanup-ownership'),source);
});

test('public config rule inspects only proven framework roles, not private options or arbitrary object names',()=>{
 for(const source of [`import{createApplicationLifecycle as create}from'zeruxjs';create({config:{publicSettings:{password:'PRIVATE_SENTINEL'}}});`, `import{createServiceScope}from'zeruxjs/services';createServiceScope({safe(){}});`, `import{defineService}from'zeruxjs';defineService({publicFields:['apiKey']});`, `import{createApplicationLifecycle}from'zeruxjs';createApplicationLifecycle({config:{publicSettings:{data:new Map()}}});`]){
  const messages=verify(source);assert.ok(messages.some(item=>item.ruleId==='zerux/public-service-config'));assert.ok(messages.every(item=>!item.message.includes('PRIVATE_SENTINEL')));
 }
 const good=`import{createApplicationLifecycle,defineService}from'zeruxjs';createApplicationLifecycle({config:{services:{x:{privateOptions:{password:'private'}}},publicSettings:{title:'Shop',enabled:true}}});defineService({publicFields:['title']});const unrelated={publicSettings:{password:'not framework config'}};`;
 assert.ok(!rules(good).includes('zerux/public-service-config'));
 assert.ok(rules(`export default{publicSettings:{credentials:{}}}`,strict,'zerux.config.mjs').includes('zerux/public-service-config'));
});

test('localization consumes actual extraction with owner domains, aliases, context/plural checks and no arbitrary JS rewriting',()=>{
 for(const source of [`import{createI18n}from'zlocale';const t=createI18n();t.__('Hello');`, `import{createI18n as make}from'zlocale/browser';const t=make();t._nx('%d item','%s items',n,'cart','shop');`, `import{createI18n}from'zlocale';const t=createI18n({domain:'shop'});t.__(dynamic);`, `import{createI18n}from'zlocale';const {__:translate}=createI18n();translate('Hello');`])assert.ok(rules(source).includes('zerux/locale-text-domain'),source);
 for(const source of [`import{createI18n}from'zlocale';const t=createI18n({domain:'shop'});t.__('Hello');`, `import{createI18n}from'zlocale';const t=createI18n();t._x('Open','button','shop');`, `import{createI18n}from'zlocale';const fr=createI18n({domain:'shop'}).forLocale('fr');fr._n('%d item','%d items',2);`, `import{createI18n}from'zlocale';const {__:translate}=createI18n({domain:'shop'});translate('Hello');`, `const t={__(x){return x}};t.__('Hello');`, `function createI18n(){return {__(x){return x}}};const t=createI18n();t.__('Hello');`])assert.ok(!rules(source).includes('zerux/locale-text-domain'),source);
 assert.ok(!rules(`import{createI18n}from'zlocale';const t=createI18n();t.__('Hello');`,light).includes('zerux/locale-text-domain'));
 const source=`import{createI18n}from'zlocale';const t=createI18n();t.__('Hello');`;
 const fixed=new Linter().verifyAndFix(source,strict,{filename:'fixture.ts'});assert.equal(fixed.output,source);assert.equal(fixed.fixed,false);
});

test('installed export maps handle exact, wildcard and blocked subpaths without executing modules',()=>{
 const root=temp();
 try{
  const pkg=path.join(root,'node_modules/fixture-package');fs.mkdirSync(pkg,{recursive:true});
  fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:'fixture-package',exports:{'.':'./index.js','./browser':'./browser.js','./features/*':'./*.js','./features/private':null}}));
  fs.writeFileSync(path.join(pkg,'index.js'),`throw new Error('must not execute');`);
  const config=createPackageConfig({cwd:root,packages:['fixture-package']});
  for(const source of [`import 'fixture-package/src/private.js';`,`import 'fixture-package/features/private';`,`import item = require('fixture-package/private');`,`type Item=import('fixture-package/private').Item;`])assert.ok(rules(source,config).includes('zerux/package-exports'));
  for(const source of [`import 'fixture-package/browser';`,`import 'fixture-package/features/ok';`,`import 'unknown-package/private';`])assert.ok(!rules(source,config).includes('zerux/package-exports'));
  assert.throws(()=>createPackageConfig({cwd:root,packages:['missing-package']}),/not installed/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('file fixture stays unchanged unless fix is explicit, scoped suppressions work and engines release file ownership',async()=>{
 const root=temp();
 try{
  const file=path.join(root,'test.js'),source=`'use client';import 'node:fs';\n`;
  fs.writeFileSync(file,source);
  const engine=new ESLint({cwd:root,overrideConfigFile:true,overrideConfig:light,fix:false});
  const result=await engine.lintFiles([file]);assert.ok(result[0].messages.some(item=>item.ruleId==='zerux/client-server-import'));assert.equal(fs.readFileSync(file,'utf8'),source);assert.equal(result[0].output,undefined);
  assert.deepEqual(rules(`'use client';\n// eslint-disable-next-line zerux/client-server-import -- reviewed test-only fixture\nimport 'node:fs';`,light),[]);
  fs.unlinkSync(file);assert.equal(fs.existsSync(file),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
