import { readFileSync } from 'node:fs';
import {
  createProjectGenerator,
  type ProjectOptions,
  type ProjectTemplate,
} from 'zclivo';
/** Read one fixed shipped template asset without evaluating it.
 * @param {string} name - Trusted internal asset filename selected by this module.
 * @returns {string} UTF-8 authored asset text; missing assets fail generation visibly.
 */
const asset = (name: string) =>
  readFileSync(new URL('../assets/' + name, import.meta.url), 'utf8');
/** Single supported CMS capability descriptor; renderer emits private host-policy-gated files only. */
const template: ProjectTemplate = {
  id: 'zenix-cms',
  capabilities: [{ mode: 'ssr', renderer: 'zyro', languages: ['javascript'] }],
  render(options) {
    return {
      'package.json':
        JSON.stringify(
          {
            name: options.packageName,
            version: '0.1.0',
            private: true,
            type: 'module',
            engines: { node: '>=24.15.0' },
            scripts: {
              dev: 'zerux dev',
              build: 'zerux build',
              start: 'zerux start',
              migrate: 'node scripts/migrate.mjs',
              typecheck: 'node --check src/index.mjs',
              test: 'node --test tests/*.test.mjs',
            },
            dependencies: {
              zenixjs: '0.0.4',
              '@zenixjs/core': '0.0.4',
              '@zeruxjs/db-sqlite': '0.0.4',
              zeruxjs: '0.0.4',
              zyrojs: '0.0.4',
            },
          },
          null,
          2
        ) + '\n',
      'zerux.config.mjs': `export default ${JSON.stringify({ type: 'fix', entryPoint: 'src/index', structure: { app: 'app', public: 'public' }, server: { port: options.port, devPort: options.port } }, null, 2)};\n`,
      'src/index.mjs': `import {registerZenix} from './register.mjs';\nimport {loadSettings} from './settings.mjs';\nimport {createHostPolicy} from './host-policy.mjs';\nexport default async function register(api){\n const settings=loadSettings();\n const policy=await createHostPolicy(); // Host must configure verified identity/CSRF before any database is opened.\n return registerZenix(api,{...policy,...settings,migrate:false,authorizeMedia:async()=>false});\n}\n`,
      'src/register.mjs': asset('register.mjs'),
      'src/settings.mjs': asset('settings.mjs'),
      'src/host-policy.mjs': asset('host-policy.mjs'),
      'scripts/migrate.mjs': asset('migrate.mjs'),
      'public/README.txt':
        'No browser bundle or public credential configuration. Zenix renders native HTML forms. Media uploads are not enabled.\n',
      '.gitignore':
        'node_modules/\n.zerux/\ndist/\n.env\nvar/\n*.sqlite*\n*.log\n',
      '.env.example': `# Placeholders only. Runtime does not auto-load this file. Use your private environment/secret manager.\nZENIX_ORIGIN=\nZENIX_DATABASE=\nZENIX_TENANT=\nZENIX_SITE=\n# Provision setup secret and identity/session/CSRF keys through your host policy; never commit values.\n`,
      'README.md': asset('README.md')
        .replaceAll('__PORT__', String(options.port))
        .replaceAll('__NAME__', options.name),
      'tests/smoke.test.mjs': `import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHostPolicy} from '../src/host-policy.mjs';\ntest('private baseline and host prerequisites',async()=>{const pkg=JSON.parse(readFileSync('package.json'));assert.equal(pkg.private,true);assert.equal(pkg.dependencies.react,undefined);assert.equal(pkg.dependencies.vue,undefined);await assert.rejects(createHostPolicy(),/HOST_POLICY_REQUIRED/);});\n`,
    };
  },
};
/** Inert safe generator over the explicit CMS template; planning performs no installation or execution. */
export const zenixAppGenerator = createProjectGenerator([template]);
/** Plan the fixed CMS template without writing or running its output.
 * @param {Omit<ProjectOptions, "template">} options - Validated shared-engine project options.
 * @returns {ReturnType<typeof zenixAppGenerator.plan>} Deterministic reviewable file plan.
 */
export const planZenixApp = (options: Omit<ProjectOptions, 'template'>) =>
  zenixAppGenerator.plan({ ...options, template: 'zenix-cms' });
