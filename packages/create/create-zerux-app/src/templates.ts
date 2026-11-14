import {
  createProjectGenerator,
  type ProjectOptions,
  type ProjectTemplate,
  type ResolvedProjectOptions,
} from 'zclivo';
/** Fixed inspected runtime/tooling versions for generated manifests, not a claim of registry publication. */
export const templateVersions = Object.freeze({
  zeruxjs: '0.0.4',
  zyrojs: '0.0.4',
  reactAdapter: '0.0.4',
  vueAdapter: '0.0.4',
  react: '19.3.1',
  vue: '3.5.44',
  typescript: '^5.9.3',
  nodeTypes: '^25.4.0',
  reactTypes: '19.3.0',
  node: '>=24.15.0',
});
/** Render the selected trusted server entry using fixed public imports.
 * @param {Readonly<ResolvedProjectOptions>} options - Capability-validated project and renderer choices.
 * @returns {string} Authored server source; it is written as inert text, never executed during planning.
 */
function entry(options: Readonly<ResolvedProjectOptions>) {
  /** Whether this validated template selection emits TypeScript syntax and declarations. */
  const ts = options.language === 'typescript';
  /** Explicit validated renderer selection; no runtime renderer discovery is performed. */
  const r = options.renderer;
  /** Fixed native SSR function name selected for the authored server entry. */
  let native;
  if (r === 'zyro') {
    native = 'renderToString';
  } else {
    if (r === 'react') {
      native = 'renderReactToStaticMarkup';
    } else {
      native = 'renderVueToString';
    }
  }
  /** Fixed reviewed public imports for only the selected renderer; never client-provided code. */
  let imports;
  if (r === 'zyro') {
    imports = "import {h,renderToString} from 'zyrojs/dom';";
  } else {
    if (r === 'react') {
      imports =
        "import {createElement as h} from 'react';\nimport {renderReactToStaticMarkup} from '@zeruxjs/react/server';";
    } else {
      imports = `import {h as vueH${ts ? ',type VNodeChild' : ''}} from '@vue/runtime-dom';\nimport {renderVueToString} from '@zeruxjs/vue/server';\nconst h=(tag${ts ? ':string' : ''},props${ts ? ':Record<string,unknown>|null' : ''},...children${ts ? ':VNodeChild[]' : ''})=>vueH(tag,props,children);`;
    }
  }
  /** Fixed framework renderer registration factory paired with the selected native SSR function. */
  let factory;
  if (r === 'zyro') {
    factory = 'createZyroRenderer';
  } else {
    if (r === 'react') {
      factory = 'createReactRenderer';
    } else {
      factory = 'createVueRenderer';
    }
  }
  return `${ts ? "import type {ZeruxPluginApi} from 'zeruxjs';\n" : ''}import {${factory}} from 'zeruxjs/renderers';\n${imports}\n\n// No module-global request/session state, browser runtime or request-time template compiler.\nexport default function register(api${ts ? ':ZeruxPluginApi' : ''}) {\n  const renderer=api.renderers().register(${factory}(async (view${ts ? `:Parameters<typeof ${native}>[0]` : ''}) => {\n    const html=await ${native}(view);\n    return /^<!doctype /i.test(html)?html:'<!doctype html>'+html;\n  }));\n  const page=(title${ts ? ':string' : ''})=>h('html',{lang:'en'},\n    h('head',null,h('meta',{${r === 'react' ? 'charSet' : 'charset'}:'utf-8'}),h('meta',{name:'viewport',content:'width=device-width, initial-scale=1'}),h('title',null,title),h('link',{rel:'stylesheet',href:'/style.css'})),\n    h('body',null,h('a',{href:'#main'},'Skip to content'),h('main',{id:'main'},h('h1',null,title),h('p',null,'Rendered on the server with ${r}. No JavaScript is required.'),h('nav',{'aria-label':'Main'},h('a',{href:'/'},'Home'),' ',h('a',{href:'/about'},'About')))));\n  for (const [pattern,title] of [['/',${JSON.stringify(options.name)}],['/about','About this app']]${ts ? ' as const' : ''}) {\n    api.addRoute({pattern,method:'GET',handler:ctx=>ctx.render(renderer,${r === 'vue' ? '{component:{render:()=>page(title)}}' : 'page(title)'})});\n  }\n  api.addRoute({pattern:'/health',method:'GET',handler:()=>({status:'ok'})});\n}\n`;
}
/** Explicit capability matrix for SSR only, with both supported source languages. */
const template: ProjectTemplate = {
  id: 'zerux-app',
  capabilities: ['zyro', 'react', 'vue'].map((renderer) => ({
    mode: 'ssr',
    renderer,
    languages: ['typescript', 'javascript'] as const,
  })),
  render(options) {
    /** Whether this validated template selection emits TypeScript syntax and declarations. */
    const ts = options.language === 'typescript';
    /** Explicit validated renderer selection; no runtime renderer discovery is performed. */
    const r = options.renderer;
    /** Private generated application runtime dependencies; only the selected renderer is added. */
    const dependencies: Record<string, string> = {
      zeruxjs: templateVersions.zeruxjs,
    };
    if (r === 'zyro') {
      dependencies.zyrojs = templateVersions.zyrojs;
    } else if (r === 'react') {
      Object.assign(dependencies, {
        '@zeruxjs/react': templateVersions.reactAdapter,
        react: templateVersions.react,
        'react-dom': templateVersions.react,
      });
    } else if (r === 'vue') {
      Object.assign(dependencies, {
        '@zeruxjs/vue': templateVersions.vueAdapter,
        vue: templateVersions.vue,
        '@vue/runtime-dom': templateVersions.vue,
        '@vue/server-renderer': templateVersions.vue,
      });
    } else {
      throw new TypeError('Renderer template unavailable');
    }
    /** Explicit generated build/typecheck dependencies, separate from runtime UI dependencies. */
    const devDependencies: Record<string, string> = {
      typescript: templateVersions.typescript,
      '@types/node': templateVersions.nodeTypes,
    };
    if (ts && r === 'react') {
      Object.assign(devDependencies, {
        '@types/react': templateVersions.reactTypes,
        '@types/react-dom': templateVersions.reactTypes,
      });
    }
    /** Explicit root entry/public structure and port configuration consumed by ZeruxJS. */
    const config = {
      type: 'fix',
      entryPoint: 'src/index',
      structure: { app: 'app', public: 'public' },
      server: { port: options.port, devPort: options.port },
    };
    /** Deterministic reviewed file map; the shared engine validates paths and owns staging. */
    const files: Record<string, string> = {
      'package.json':
        JSON.stringify(
          {
            name: options.packageName,
            version: '0.1.0',
            private: true,
            type: 'module',
            engines: { node: templateVersions.node },
            scripts: {
              dev: 'zerux dev',
              build: 'zerux build',
              start: 'zerux start',
              test: 'node --test tests/*.test.mjs',
              typecheck: ts ? 'tsc --noEmit' : 'node --check src/index.mjs',
            },
            dependencies,
            devDependencies,
          },
          null,
          2
        ) + '\n',
      '.gitignore': 'node_modules/\n.zerux/\ndist/\n.env\n*.log\n',
      '.env.example':
        '# No secrets are needed for this public SSR starter.\n# Add private provider settings only after configuring authentication and storage.\n',
      [ts ? 'zerux.config.ts' : 'zerux.config.mjs']: ts
        ? `import type {ZeruxConfig} from 'zeruxjs';\nconst config:ZeruxConfig=${JSON.stringify(config, null, 2)};\nexport default config;\n`
        : `export default ${JSON.stringify(config, null, 2)};\n`,
      [ts ? 'src/index.ts' : 'src/index.mjs']: entry(options),
      'public/style.css':
        'body{margin:0;font-family:system-ui,sans-serif;color:#172033;background:#fff}main{max-width:60rem;margin:2rem auto;padding:1rem}a{color:#0645ad}a:focus-visible{outline:3px solid #9b3900;outline-offset:3px}nav a{margin-right:1rem}\n',
      'tests/smoke.test.mjs': `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {readFileSync,existsSync} from 'node:fs';\ntest('public app manifest and entry exist',()=>{const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));assert.equal(pkg.private,true);assert.ok(existsSync(new URL('../src/${ts ? 'index.ts' : 'index.mjs'}',import.meta.url)));});\n`,
      'README.md': `# ${options.name}\n\nGenerated public ${r} SSR application for ZeruxJS. Node ${templateVersions.node}; mode: ssr.\n\n## Explicit commands\n\nReview package.json, then run npm install. Choose npm run dev, npm run build, npm start, npm test or npm run typecheck explicitly. The generator installed and ran nothing. Port ${options.port} is configuration, not a reservation; if occupied, choose another --port when generating or edit server.port and server.devPort. Never terminate the occupying application automatically. Hosting modes can have additional proxy/listener policy; inspect its error before changing it.\n\n## Actual scope\n\nRoutes / and /about render complete public HTML through the framework renderer registry; /health is JSON. public/style.css is the explicitly configured public asset at /style.css and is copied by zerux build. The entry is src/index, configured explicitly; production start uses the compiled manifest. No database, cache provider, sessions, secrets, remote services or plugins are configured. Authentication/tenant authorization is required before adding private data.\n\nRenderer: ${r}. Only its selected dependencies are included. This template uses authored render functions, not JSX/SFC/request-time compilation. React static markup cannot hydrate. Vue creates a fresh SSR app per render via its adapter. Zyro uses escaped static HTML. All generated modes are HTML-only SSR, not streaming components or static export.\n\nHydration, browser navigation/prefetch, client-only code and RSC are not installed. The existing browser router requires explicit compatible route metadata, manifest assets, client entry/module loading and authenticated scope; ordinary links work without JavaScript now. Do not enable hydration by adding a random script URL or hydrating React static markup. Keep matching runtime/server versions and consult each adapter's public README before expanding capabilities.\n\nPublished dependencies are pinned to inspected ecosystem 0.0.4 contracts. A local checkout may be ahead of the registry: verify the installed exports or use qualified local workspace artifacts. Do not assume a registry version contains unshipped source changes.\n\n## Qualification\n\nThe smoke test only inspects the manifest/source; it is not a browser, production listener or dependency-health test. Run install/build/typecheck/runtime checks in your environment. Never treat this public demo as an authorization or deployment configuration.\n`,
    };
    if (ts) {
      files['tsconfig.json'] =
        JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              strict: true,
              noEmit: true,
              skipLibCheck: true,
              types: ['node'],
              lib: ['ES2022', 'DOM', 'DOM.Iterable'],
            },
            include: ['src/**/*.ts', 'zerux.config.ts'],
          },
          null,
          2
        ) + '\n';
    }
    return files;
  },
};
/** Inert shared safe engine configured with this explicit template only. */
export const zeruxAppGenerator = createProjectGenerator([template]);
/** Plan a supported SSR app without writing files or running generated code.
 * @param {Omit<ProjectOptions, "template">} options - Shared validated name/path/language/renderer/port options.
 * @returns {ReturnType<typeof zeruxAppGenerator.plan>} Deterministic file plan for explicit review and writing.
 */
export const planZeruxApp = (options: Omit<ProjectOptions, 'template'>) =>
  zeruxAppGenerator.plan({ ...options, template: 'zerux-app' });
