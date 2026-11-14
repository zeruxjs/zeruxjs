import { readFileSync } from 'node:fs';
import {
  createProjectGenerator,
  type ProjectOptions,
  type ProjectTemplate,
} from 'zclivo';
/** Implemented standalone output modes; selective hydration is deliberately excluded. */
export type ZyroMode = 'client' | 'static' | 'ssr' | 'hydrated';
/** Accept only a simple rooted public mount and normalize one trailing slash.
 * @param {unknown} value - Untrusted CLI/config mount candidate.
 * @returns {string} Canonical root or slash-separated ASCII mount without traversal/empty segments.
 */
export function validateBasePath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?\/?$/.test(value) ||
    value.includes('//')
  ) {
    throw new TypeError(
      'Base path must be / or simple slash-separated public segments'
    );
  }
  return value === '/' ? '/' : value.replace(/\/$/, '');
}
/** Read one fixed shipped authored asset without executing its source.
 * @param {string} name - Trusted internal asset filename.
 * @returns {string} UTF-8 shipped source text; missing assets fail visibly.
 */
const asset = (name: string) =>
  readFileSync(new URL('../assets/' + name, import.meta.url), 'utf8');
/** Create an inert safe generator whose templates close over one validated mount.
 * @param {string} basePath - Explicit public mount, defaulting to root.
 * @returns {ReturnType<typeof createProjectGenerator>} Capability-validated planning/writing engine; importing it starts no app.
 */
export function createZyroProjectGenerator(basePath = '/') {
  basePath = validateBasePath(basePath);
  /** Explicit supported standalone mode/language capability matrix. */
  const template: ProjectTemplate = {
    id: 'zyro-app',
    capabilities: ['client', 'static', 'ssr', 'hydrated'].map((mode) => ({
      mode,
      renderer: 'zyro',
      languages: ['typescript', 'javascript'] as const,
    })),
    render(options) {
      /** Whether validated project options select TypeScript output. */
      const ts = options.language === 'typescript';
      /** Fixed source extension paired with the validated language. */
      const extension = ts ? 'ts' : 'mjs';
      /** Capability-validated standalone rendering mode, never executable configuration. */
      const mode = options.mode as ZyroMode;
      /** Generated runtime dependencies for the standalone library and security encoders. */
      const dependencies: Record<string, string> = {
        zyrojs: '0.0.4',
        '@zeruxjs/security': '0.0.4',
      };
      /** Explicit generated build tooling; static mode also consumes the general exporter. */
      const devDependencies: Record<string, string> = { esbuild: '0.28.2' };
      if (ts) {
        devDependencies.typescript = '^5.9.3';
      }
      if (mode === 'static') {
        devDependencies.zeruxjs = '0.0.4';
        devDependencies.parse5 = '7.3.0';
      }
      /** Authored public-props validator text; never evaluated during planning. */
      const props = `${ts ? 'export interface PublicProps {title:string;interactive:boolean}\n' : ''}export function validatePublicProps(value${ts ? ':unknown' : ''})${ts ? ':PublicProps' : ''}{\n if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['title','interactive'].includes(key)))throw Error('Invalid public props');\n const props=value${ts ? ' as Record<string,unknown>' : ''};\n if(typeof props.title!=='string'||props.title.length>200||typeof props.interactive!=='boolean')throw Error('Invalid public props');\n return {title:props.title,interactive:props.interactive};\n}\n`;
      /** Trusted generated component source with explicit public props and native controls. */
      const app = `import {h,defineComponent,signal${mode === 'hydrated' ? ',useId' : ''}} from 'zyrojs/component';\n${ts ? "import type {PublicProps} from './public-props.js';\n" : ''}export {validatePublicProps} from './public-props.${ts ? 'js' : 'mjs'}';\nexport const App=defineComponent${ts ? '<PublicProps>' : ''}((props)=>{\n const count=signal(0),id=${mode === 'hydrated' ? 'useId()' : "'example-input'"};\n return ()=>h('main',null,h('h1',null,props.title),h('label',{for:id},'Example input'),h('input',{id,value:'Type here'}),h('p',{'aria-live':'polite','data-count':'true'},'Count: '+count.value),h('button',{type:'button',disabled:!props.interactive,onClick:()=>{count.value++;}},'Increment'));\n});\n`;
      /** Mode-specific authored browser entry; no server policy or secrets are bundled. */
      const client =
        mode === 'hydrated'
          ? `import {App,validatePublicProps} from './App.${ts ? 'js' : 'mjs'}';\nimport {hydrate} from 'zyrojs/hydrate';\nconst root=document.querySelector('#app'),data=document.querySelector('#zyro-state');\nif(!(root instanceof HTMLElement)||!(data instanceof HTMLScriptElement)||data.type!=='application/json')throw Error('Missing hydration root/data');\nconst lifetime=new AbortController();\nconst handle=hydrate(App,root,{data:data.textContent??'',validateProps:validatePublicProps,signal:lifetime.signal,mismatch:'throw',onMismatch:diagnostic=>console.error('Hydration mismatch',diagnostic.code)});\nconst onPageHide=(event${ts ? ':PageTransitionEvent' : ''})=>{if(!event.persisted){window.removeEventListener('pagehide',onPageHide);lifetime.abort();handle.dispose();}};\nwindow.addEventListener('pagehide',onPageHide);\n`
          : `import {App,validatePublicProps} from './App.${ts ? 'js' : 'mjs'}';\nimport {h,render,unmount} from 'zyrojs/dom';\nconst root=document.querySelector('#app');if(!(root instanceof HTMLElement))throw Error('Missing client root');\nroot.replaceChildren();\nrender(h(App,validatePublicProps({title:document.title,interactive:true})),root);\nconst onPageHide=(event${ts ? ':PageTransitionEvent' : ''})=>{if(!event.persisted){window.removeEventListener('pagehide',onPageHide);unmount(root);}};\nwindow.addEventListener('pagehide',onPageHide);\n`;
      /** Reviewable deterministic file map; zclivo owns validation/staging/promotion. */
      const files: Record<string, string> = {
        'package.json':
          JSON.stringify(
            {
              name: options.packageName,
              version: '0.1.0',
              private: true,
              type: 'module',
              engines: { node: '>=24.15.0' },
              scripts: {
                build: 'node scripts/build.mjs',
                dev: 'npm run build && npm start',
                start: ['ssr', 'hydrated'].includes(mode)
                  ? 'node dist/server.mjs'
                  : 'node scripts/serve.mjs',
                typecheck: ts ? 'tsc --noEmit' : 'node --check src/App.mjs',
                test: 'node --test tests/*.test.mjs',
              },
              dependencies,
              devDependencies,
            },
            null,
            2
          ) + '\n',
        'zyro.config.json':
          JSON.stringify(
            {
              mode,
              language: options.language,
              port: options.port,
              basePath,
              title: options.name,
              origin: 'http://localhost:' + options.port,
            },
            null,
            2
          ) + '\n',
        '.gitignore': 'node_modules/\ndist/\n.zyro-*\n.env\n*.log\n',
        '.env.example':
          '# Public demonstration only. No credentials or private user state are configured.\n',
        ['src/App.' + extension]: app,
        ['src/public-props.' + extension]: props,
        'public/style.css':
          'body{font-family:system-ui,sans-serif;color:#172033;background:white}main{max-width:40rem;margin:2rem auto;padding:1rem}label,input,button{display:block;margin-block:1rem}button:focus-visible,input:focus-visible{outline:3px solid #0645ad;outline-offset:3px}\n',
        'scripts/build.mjs': asset('build.ts').replace(
          '__MODE_JSON__',
          JSON.stringify(mode)
        ),
        'scripts/config.mjs': asset('config.mjs'),
        'scripts/http.mjs': asset('http.mjs'),
        'tests/smoke.test.mjs': `import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';test('private standalone project',()=>{const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));assert.equal(pkg.private,true);assert.ok(pkg.dependencies.zyrojs);});\n`,
        'README.md': `# ${options.name}\n\nStandalone ZyroJS ${mode} project. Base path: ${basePath}; Node >=24.15.0.\n\nReview package.json, then explicitly run npm install, npm run build and npm start. npm run dev is a build-and-preview command, not a watcher/HMR server. Nothing was installed or started by the generator. Preview binds loopback port ${options.port}; choose a different port in zyro.config.json on conflict. No existing process is stopped.\n\nMode is fixed by the generated build script; generate another project to change modes. The public config accepts only mode/language/port/basePath/title/origin. Before publishing static files, replace the local canonical origin with your reviewed public site origin. Edit basePath and rebuild to move the mount. Serve dist as the host root, including its base subdirectory, and configure real 404 behavior. Never use a universal SPA fallback.\n\nClient mode mounts a component and needs JavaScript; static uses zeruxjs/static-export for deterministic public HTML/404/assets; ssr renders disabled HTML controls on each request without JavaScript; hydrated renders a V1 whole-root tree plus script-safe public JSON and a matching browser bundle. Hydration mismatches throw with a fixed diagnostic rather than silently replacing edited form nodes. Selective hydration, client routing, streaming components, RSC and template-string compilation are not implemented.\n\nOnly explicit title/interactive public props are serialized. App/public-props/client are the reviewed public source graph; adding other client sources requires explicit review. Browser bundling rejects Node/network imports and unapproved local source modules before output publication. Do not put secrets in these public sources or title. Server modules stay outside the browser entry graph; these checks are not runtime authorization or a sandbox for edited build scripts.\n\nThe example counter/input are authored native controls. The client owns teardown on non-persisted pagehide; cached documents retain state. No auth, API, storage, React or Vue runtime is configured. SSR/hydrated output needs Node plus installed dependencies; client/static output needs a suitable static host with mounted assets and 404 rules. Build manifests own asset URLs; no source maps or guessed runtime import URLs are emitted.\n\nWorkspace source versions 0.0.4 may be ahead of published artifacts. Inspect installed exports before use. esbuild 0.28.2 is explicit build tooling; its native platform binary must be available. Read the package README for build/SSR/hydration qualification and remaining browser/production prerequisites.\n`,
      };
      if (['client', 'hydrated'].includes(mode)) {
        files['src/client.' + extension] = client;
      }
      if (['ssr', 'hydrated'].includes(mode)) {
        files['src/server.mjs'] = asset('server.mjs').replace(
          "'./App.js'",
          JSON.stringify('./App.' + extension)
        );
      } else {
        files['scripts/serve.mjs'] = asset('serve.ts');
      }
      if (ts) {
        files['tsconfig.json'] =
          JSON.stringify(
            {
              compilerOptions: {
                target: 'ES2022',
                module: 'ESNext',
                moduleResolution: 'Bundler',
                strict: true,
                noEmit: true,
                skipLibCheck: true,
                types: [],
                lib: ['ES2022', 'DOM', 'DOM.Iterable'],
              },
              include: ['src/**/*.ts'],
            },
            null,
            2
          ) + '\n';
      }
      return files;
    },
  };
  return createProjectGenerator([template]);
}
/** Inert default-root generator; importing creates no prompt, watcher or server. */
export const zyroAppGenerator = createZyroProjectGenerator();
/** Plan a standalone project without writing, installing or executing its output.
 * @param {Omit<ProjectOptions, 'template'> & {basePath?: string}} options - Shared project choices plus the creator-owned mount.
 * @returns {ReturnType<typeof zyroAppGenerator.plan>} Reviewable deterministic file plan.
 */
export function planZyroApp(
  options: Omit<ProjectOptions, 'template'> & { basePath?: string }
) {
  /** Separate the creator-owned public mount from the shared project options. */
  const { basePath = '/', ...project } = options;
  return createZyroProjectGenerator(basePath).plan({
    ...project,
    template: 'zyro-app',
  });
}
