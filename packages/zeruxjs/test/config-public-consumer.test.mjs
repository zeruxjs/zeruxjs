import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  symlink,
  rm,
  unlink,
} from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

test('packed public exports expose inferred schema settings without source aliases', async () => {
  /** Framework package directory packed without executing lifecycle scripts. */
  const pkg = fileURLToPath(new URL('..', import.meta.url));
  /** Repository root supplying already installed compiler and dependency links. */
  const root = path.resolve(pkg, '../..');
  /** Isolated packed consumer directory removed after all compile/runtime checks. */
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'zerux-public-'));
  try {
    /** Structured npm archive receipt used to locate the unpublished local tarball. */
    const packResult = JSON.parse(
      execFileSync(
        'npm',
        [
          'pack',
          '--cache',
          path.join(temporary, 'cache'),
          '--ignore-scripts',
          '--json',
          '--pack-destination',
          temporary,
        ],
        { cwd: pkg, encoding: 'utf8' }
      )
    );
    /** Single framework archive entry normalized across npm receipt shapes. */
    const packed = Array.isArray(packResult)
      ? packResult[0]
      : Object.values(packResult)[0];
    /** Extracted package destination exercising only the packed export map. */
    const installed = path.join(temporary, 'node_modules', 'zeruxjs');
    await mkdir(installed, { recursive: true });
    execFileSync('tar', [
      '-xzf',
      path.join(temporary, packed.filename),
      '-C',
      installed,
      '--strip-components=1',
    ]);
    for (const name of await readdir(path.join(root, 'node_modules'))) {
      if (name !== 'zeruxjs' && name !== '.bin') {
        if (name === '@zeruxjs') {
          await mkdir(path.join(temporary, 'node_modules', name));
          for (const scoped of await readdir(
            path.join(root, 'node_modules', name)
          )) {
            if (scoped !== 'db-sqlite') {
              await symlink(
                path.join(root, 'node_modules', name, scoped),
                path.join(temporary, 'node_modules', name, scoped)
              );
            }
          }
        } else {
          await symlink(
            path.join(root, 'node_modules', name),
            path.join(temporary, 'node_modules', name)
          );
        }
      }
    }
    /** Packed manifest checked independently of workspace source aliases. */
    const manifest = JSON.parse(
      await readFile(path.join(installed, 'package.json'), 'utf8')
    );
    assert.equal(manifest.exports['.'], './dist/index.js');
    await writeFile(path.join(temporary, 'package.json'), '{"type":"module"}');
    await writeFile(
      path.join(temporary, 'consumer.ts'),
      `import { defineService, resolveApplicationConfig, createRequestObserver, getRequestCorrelation, ApplicationError, createHealthHandler } from 'zeruxjs';
import { createServerLifecycleHooks } from '@zeruxjs/hooks/lifecycle';
import { object, string, pipe, transform } from '@zeruxjs/validator/schemas';
import {createProviderToken,defineProvider,defineController,registerModule} from 'zeruxjs/modules';
import {registerGraphQL,type GraphQLResolver} from 'zeruxjs/graphql';
import {createRendererRegistry,createZyroRenderer,createZyroDocumentRenderer,createRenderAssets} from 'zeruxjs/renderers';
const documentRenderer=createZyroDocumentRenderer({security:()=>({headers:{}}),render:(view:{label:string})=>({html:view.label})});
const assets=createRenderAssets({schema:1,assets:[],namedEntries:{}});
const documentRegistry=createRendererRegistry(),documentToken=documentRegistry.register(documentRenderer),documentSignal=new AbortController();
await documentRegistry.render(documentToken,{label:'safe'},{requestId:'document',pathname:'/',signal:documentSignal.signal});
documentSignal.abort();await documentRegistry.close();
const rendererRegistry=createRendererRegistry();const renderer=rendererRegistry.register(createZyroRenderer((view:string)=>'<p>'+view+'</p>'));const rendererSignal=new AbortController();
// @ts-expect-error typed renderer registration requires a string view
const wrongView=()=>rendererRegistry.render(renderer,123,{requestId:'consumer',pathname:'/',signal:rendererSignal.signal});
await rendererRegistry.render(renderer,'typed',{requestId:'consumer',pathname:'/',signal:rendererSignal.signal});rendererSignal.abort();await rendererRegistry.close();
const typedResolver:GraphQLResolver<unknown,{name:string},string>=(_source,args,context)=>{
const tenant:string=context.principal.tenant;
// @ts-expect-error GraphQL resolver arguments preserve the declared string type
const invalid:number=args.name;
return args.name;
};
import {createServiceClient,createTransactionalOutbox,type ServiceEndpointDefinition} from 'zeruxjs/service-endpoints';
const client=createServiceClient<{label:string},{label:string}>({endpoint:'http://127.0.0.1:1/explicit',timeoutMs:100,maxPayloadBytes:1024,maxConcurrent:1,transport:fetch,allowDestination:url=>url.hostname==='127.0.0.1',schema:object({label:string()}),retry:{maxAttempts:1,idempotent:false}});
const typedCall=()=>client.call({label:'safe'});
// @ts-expect-error declared request type requires string label
const invalidCall=()=>client.call({label:123});
await client.close();
const Count=createProviderToken<number>('Count');
const numberProvider=defineProvider({token:Count,scope:'request',dependencies:[],create:()=>1});
const textToken=createProviderToken<string>('Text');
defineProvider({token:textToken,scope:'request',dependencies:[Count],create:(_ctx,value)=>value.toFixed()});
defineController({path:'/typed',schema:object({length:pipe(string(),transform(value=>value.length))}),async handle(input,_context,providers){
const length:number=input.length;
// @ts-expect-error transformed output is numeric
const wrong:string=input.length;
const count:number=await providers.get(Count);
return {length,count};
}});
const service=defineService({name:'custom:example',namespace:'example',schema:object({label:string()}),start({settings}){
const label:string=settings.label;
// @ts-expect-error schema output is a string
const wrong:number=settings.label;
return {value:{label}};
}});
const observer=createRequestObserver({applicationId:'example',createAdapter:()=>({export(span,signal){const requestId:string=span.requestId;const stopped:boolean=signal.aborted;}})});
const health=createHealthHandler(()=>({live:true,ready:true}));
const requestId:string|undefined=getRequestCorrelation()?.requestId;
new ApplicationError(422, new Error('private'));
await observer.close();
const lifecycleHooks=createServerLifecycleHooks(); lifecycleHooks.register('request:after',context=>{const status:number=context.status;});
await resolveApplicationConfig({overrides:{lifecycleHooks,serviceDefinitions:[service],services:{example:{settings:{label:'hello'}}}}});
`
    );
    /** Packed authored documentation supplying the public-import compiler fixtures. */
    const readme = await readFile(path.join(installed, 'README.md'), 'utf8');
    /** Renderer documentation block compiled as an isolated consumer module. */
    const example = readme
      .slice(
        readme.indexOf(
          '### Zyro documents, streamed responses and client assets'
        )
      )
      .match(/```ts\n([\s\S]*?)```/)[1];
    await writeFile(path.join(temporary, 'document-example.ts'), example);
    /** Server/browser action examples kept separate to check their public boundaries. */
    const actionExamples = [
      ...readme
        .slice(readme.indexOf('### Registered server actions and forms'))
        .matchAll(/```ts\n([\s\S]*?)```/g),
    ].map((match) => match[1]);
    await writeFile(
      path.join(temporary, 'actions-server.ts'),
      actionExamples[0]
    );
    await writeFile(
      path.join(temporary, 'actions-browser.ts'),
      actionExamples[1]
    );
    /** Authored general-export example compiled against packed declarations. */
    const staticExample = readme
      .slice(readme.indexOf('### Explicit static export'))
      .match(/```ts\n([\s\S]*?)```/)[1];
    await writeFile(path.join(temporary, 'static-example.ts'), staticExample);

    assert.doesNotMatch(
      await readFile(path.join(installed, 'dist/action-stores.d.ts'), 'utf8'),
      /db-sqlite/
    );

    /** Navigation documentation blocks selected for server and browser consumers. */
    const navigationExamples = [
      ...readme
        .slice(readme.indexOf('### Progressive browser navigation'))
        .matchAll(/```ts\n([\s\S]*?)```/g),
    ].map((match) => match[1]);
    await writeFile(
      path.join(temporary, 'navigation-server.ts'),
      navigationExamples[1]
    );
    await writeFile(
      path.join(temporary, 'navigation-browser.ts'),
      navigationExamples[2]
    );

    execFileSync(
      process.execPath,
      [
        path.join(root, 'node_modules/typescript/bin/tsc'),
        '--noEmit',
        '--types',
        'node',
        '--strict',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        path.join(temporary, 'consumer.ts'),
        path.join(temporary, 'document-example.ts'),
        path.join(temporary, 'navigation-server.ts'),
        path.join(temporary, 'navigation-browser.ts'),
        path.join(temporary, 'actions-server.ts'),
        path.join(temporary, 'actions-browser.ts'),
        path.join(temporary, 'static-example.ts'),
      ],
      { encoding: 'utf8', cwd: temporary }
    );
    await writeFile(
      path.join(temporary, 'browser-only.ts'),
      "import {createBrowserRouter,createDocumentNavigationRenderer} from 'zeruxjs/browser-navigation';export {enhanceActionForm} from 'zeruxjs/action-form';export const browser={createBrowserRouter,createDocumentNavigationRenderer};"
    );
    await writeFile(
      path.join(temporary, 'tsconfig.browser.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          types: [],
        },
        files: ['browser-only.ts'],
      })
    );
    execFileSync(
      process.execPath,
      [
        path.join(root, 'node_modules/typescript/bin/tsc'),
        '-p',
        path.join(temporary, 'tsconfig.browser.json'),
      ],
      { encoding: 'utf8', cwd: temporary }
    );
    await writeFile(
      path.join(temporary, 'runtime.mjs'),
      "await import('zeruxjs/browser-navigation');import {createApplicationLifecycle} from 'zeruxjs'; const app=await createApplicationLifecycle({rootDir:process.cwd(),config:{},providers:{database:async()=>null,cache:async()=>null}}); const {registerGraphQL}=await import('zeruxjs/graphql');await registerGraphQL(app.runtime().asPluginApi(),{name:'packed',path:'/graphql',typeDefs:'type Query {hello:String}',resolvers:{Query:{hello:()=> 'hello'}},authenticate:()=>null,authorizeField:()=>false,authorizeData:()=>false,protectMutation:()=>false,introspection:false,persisted:{required:false,operations:{}}}); await app.close();const {createRendererRegistry,createZyroRenderer,isRenderedHtml}=await import('zeruxjs/renderers');const registry=createRendererRegistry(),signal=new AbortController(),token=registry.register(createZyroRenderer(view=>'<p>'+view+'</p>'));const result=await registry.render(token,'installed',{requestId:'consumer',pathname:'/',signal:signal.signal});if(!isRenderedHtml(result)||result.html!=='<p>installed</p>')throw Error('Renderer export');signal.abort();await registry.close();"
    );
    execFileSync(process.execPath, [path.join(temporary, 'runtime.mjs')], {
      encoding: 'utf8',
      cwd: temporary,
    });
    await unlink(path.join(temporary, 'node_modules/parse5'));
    await writeFile(
      path.join(temporary, 'missing-static-peer.mjs'),
      "await import('zeruxjs');let missing=false;try{await import('zeruxjs/static-export');}catch(error){missing=error.code==='ERR_MODULE_NOT_FOUND'&&error.message.includes('parse5');}if(!missing)throw Error('Optional static parser boundary');"
    );
    execFileSync(
      process.execPath,
      [path.join(temporary, 'missing-static-peer.mjs')],
      { encoding: 'utf8', cwd: temporary }
    );
    await symlink(
      path.join(root, 'node_modules/parse5'),
      path.join(temporary, 'node_modules/parse5')
    );
    await writeFile(
      path.join(temporary, 'static-runtime.mjs'),
      "import {exportStaticSite} from 'zeruxjs/static-export';import {createZyroRenderer} from 'zeruxjs/renderers';import {h,renderToString} from 'zyrojs/dom';import {readFile,mkdir} from 'node:fs/promises';const root=process.cwd()+'/static-project';await mkdir(root);const manifest=await exportStaticSite({rootDir:root,origin:'https://example.test',basePath:'/catalog',renderer:()=>createZyroRenderer(view=>renderToString(h('h1',{},view.heading))),routes:[{path:'/catalog',access:'public',view:()=>({heading:'Packed static HTML'})}],notFound:{access:'public',view:{heading:'Missing'}}});if(manifest.pages.length!==2||!(await readFile(root+'/.zerux/static/catalog/index.html','utf8')).includes('Packed static HTML'))throw Error('Packed static export');"
    );
    execFileSync(
      process.execPath,
      [path.join(temporary, 'static-runtime.mjs')],
      { encoding: 'utf8', cwd: temporary }
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
