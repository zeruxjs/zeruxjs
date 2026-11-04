import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import type { Linter } from 'eslint';
import { createZeruxPlugin } from './rules.js';
import { readPackageExportContracts } from './contracts.js';

export interface PresetOptions {
 /** Explicit ambient globals; does not classify authorization or runtime trust. */
 environment?: 'node'|'browser'|'universal';
 /** Used only when reading explicitly selected installed package manifests. */
 cwd?: string;
 /** Empty by default. Missing declared packages fail configuration, never fall back to source paths. */
 packages?: readonly string[];
}
const files=['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'];
const typescript=['**/*.{ts,mts,cts,tsx}'];
const security:Record<string,Linter.RuleEntry>={
 'no-eval':'error','no-implied-eval':'error','no-new-func':'error',
 'zerux/client-server-import':'error','zerux/public-service-config':'error',
 'zerux/package-exports':'error','zerux/cleanup-ownership':'error',
 'zerux/a11y-required-label':'error','zerux/a11y-relationships':'error',
};
function optionsFor(options:PresetOptions) {
 const environment=options.environment??'universal';
 if(!['node','browser','universal'].includes(environment)||options.cwd!==undefined&&typeof options.cwd!=='string')throw new TypeError('lint: invalid preset options');
 const contracts=readPackageExportContracts(options.cwd??process.cwd(),options.packages??[]);
 return {environment,contracts};
}
/** Light package configuration: parser correctness + named security rules, no formatting/runtime plugins.
 * Reads installed manifests only when packages is explicitly configured. Does not run any engine.
 */
export function createPackageConfig(options:PresetOptions={}):Linter.Config[] {
 const {environment,contracts}=optionsFor(options);
 const plugin=createZeruxPlugin(contracts);
 const ambient=environment==='node'?globals.node:environment==='browser'?globals.browser:{};
 return [
  {name:'zerux/ignores',ignores:['**/node_modules/**','**/dist/**','**/build/**','**/.zerux/**','**/.output/**','**/coverage/**']},
  {name:'zerux/package',files:[...files],languageOptions:{ecmaVersion:'latest',sourceType:'module',parserOptions:{ecmaFeatures:{jsx:true}},globals:{...globals.es2022,...ambient}},plugins:{zerux:plugin},rules:{...js.configs.recommended.rules,...security,'no-unused-vars':['warn',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}]}},
  // Keep recommended parser-aware diagnostics scoped to TS rather than parsing every framework file.
  ...tseslint.configs.recommended.map(config=>({...config,files:[...typescript]})) as Linter.Config[],
  {name:'zerux/package-types',files:[...typescript],rules:{'@typescript-eslint/no-explicit-any':'off','@typescript-eslint/no-unused-vars':['warn',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}],...security}},
 ];
}
/** Strict application configuration uses zlocale's real extractor through its optional build peer.
 * Import failure is explicit and happens only when this factory/strict entry is selected.
 */
export async function createApplicationConfig(options:PresetOptions={}):Promise<Linter.Config[]> {
 const {environment,contracts}=optionsFor(options);
 const {extractMessages}=await import('zlocale/build');
 const config=createPackageConfig({...options,environment});
 // Replace only our plugin object before ESLint sees the array, keeping one plugin identity.
 for(const entry of config)if(entry.plugins?.zerux)entry.plugins={...entry.plugins,zerux:createZeruxPlugin(contracts,extractMessages)};
 return [...config,
  {name:'zerux/application',files:[...files],rules:{...security,'zerux/locale-text-domain':'error','no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}]}},
  {name:'zerux/application-types',files:[...typescript],rules:{'no-unused-vars':'off','@typescript-eslint/no-explicit-any':'warn','@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}],...security}},
 ];
}
/** Fresh factories are preferred when adding local overrides; this value performs no linting/I/O. */
export const packageDevelopment:Linter.Config[]=createPackageConfig();
