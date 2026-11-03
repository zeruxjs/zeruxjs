import path from 'node:path';
import {builtinModules,createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import type * as TypeScript from 'typescript';
export interface BuildSource {relative:string;source:string;publicPath?:string;serverOnly?:boolean;routeModule?:boolean}
export type ModuleEnvironment='server'|'client'|'shared';
export interface ClassifiedModule {path:string;declared:'server'|'client'|'neutral';environment:ModuleEnvironment;imports:string[];hash:string}
export interface ModuleClassification {modules:ClassifiedModule[];clientEntries:string[];clientModules:Set<string>;edges:Map<string,Map<string,string>>}
export {ModuleBoundaryError} from './boundary-error.js';
import {ModuleBoundaryError} from './boundary-error.js';
const SCRIPT=/\.[cm]?[jt]sx?$/i;
const builtins=new Set(builtinModules.map(name=>name.replace(/^node:/,'')));
const serverGlobals=new Set(['process','Buffer','global','__dirname','__filename','require','module','exports','eval','Function']);
const normalize=(value:string)=>value.split(path.sep).join('/');
/** Parse actual directive prologues/import syntax, never regex-match directives in comments/strings. */
export async function loadBuildParser(root:string):Promise<typeof TypeScript>{
  try{return createRequire(path.join(root,'package.json'))('typescript');}
  catch{try{return await import('typescript');}catch{throw new ModuleBoundaryError('TYPESCRIPT_CLASSIFIER_REQUIRED',[]);}}
}
function parsed(ts:typeof TypeScript,file:BuildSource){return ts.createSourceFile(file.relative,file.source,ts.ScriptTarget.Latest,true, /\.tsx$/i.test(file.relative)?ts.ScriptKind.TSX:/\.jsx$/i.test(file.relative)?ts.ScriptKind.JSX:ts.ScriptKind.TS);}
function imports(ts:typeof TypeScript,source:TypeScript.SourceFile){
  const found:{specifier:string;start:number;end:number}[]=[];let dynamic=false,serverUse=false;
  // Browser bundlers wrap compatible CommonJS modules in local {exports:{}} data.
  // Property names are not references to Node's free `exports` binding. Require
  // an actual local base; globalThis/window/self.exports remain server use.
  const bindings=new Set<string>();
  const bind=(name:TypeScript.BindingName)=>{if(ts.isIdentifier(name))bindings.add(name.text);else for(const item of name.elements)if(ts.isBindingElement(item))bind(item.name);};
  const collect=(node:TypeScript.Node)=>{if(ts.isVariableDeclaration(node)||ts.isParameter(node))bind(node.name);ts.forEachChild(node,collect);};
  collect(source);
  const localBase=(input:TypeScript.Expression):boolean=>{
    let node=input;while(ts.isParenthesizedExpression(node))node=node.expression;
    if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken)node=node.left;
    return ts.isIdentifier(node)&&bindings.has(node.text)&&!serverGlobals.has(node.text)&&!['globalThis','window','self'].includes(node.text);
  };
  const localExportProperty=(node:TypeScript.Identifier)=>node.text==='exports'&&(
    ts.isPropertyAssignment(node.parent)&&node.parent.name===node||
    ts.isPropertyAccessExpression(node.parent)&&node.parent.name===node&&localBase(node.parent.expression)
  );
  const literal=(node:TypeScript.Node)=>{if(ts.isStringLiteral(node))found.push({specifier:node.text,start:node.getStart(source),end:node.end});else dynamic=true;};
  const walk=(node:TypeScript.Node)=>{
    if(ts.isTypeNode(node))return;
    if(ts.isImportDeclaration(node)){
      if(node.importClause?.isTypeOnly)return;
      const clause=node.importClause;if(clause&&!clause.name&&clause.namedBindings&&ts.isNamedImports(clause.namedBindings)&&clause.namedBindings.elements.every(item=>item.isTypeOnly))return;
      literal(node.moduleSpecifier);return;
    }
    if(ts.isExportDeclaration(node)&&node.moduleSpecifier){if(node.isTypeOnly)return;if(node.exportClause&&ts.isNamedExports(node.exportClause)&&node.exportClause.elements.every(item=>item.isTypeOnly))return;literal(node.moduleSpecifier);return;}
    if(ts.isImportEqualsDeclaration(node)){if(node.isTypeOnly)return;if(ts.isExternalModuleReference(node.moduleReference)&&node.moduleReference.expression)literal(node.moduleReference.expression);else dynamic=true;serverUse=true;return;}
    if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==='require')){if(node.arguments.length!==1)dynamic=true;else literal(node.arguments[0]);}
    if(ts.isIdentifier(node)&&serverGlobals.has(node.text)&&!localExportProperty(node))serverUse=true;
    if(ts.isElementAccessExpression(node)&&node.argumentExpression&&ts.isStringLiteral(node.argumentExpression)&&serverGlobals.has(node.argumentExpression.text))serverUse=true;
    if(ts.isMetaProperty(node))serverUse=true; // import.meta/env has no declared public substitution policy.
    ts.forEachChild(node,walk);
  };walk(source);return {found,dynamic,serverUse};
}
function directive(ts:typeof TypeScript,source:TypeScript.SourceFile){
  let client=/\.client\.[cm]?[jt]sx?$/i.test(source.fileName),server=/\.server\.[cm]?[jt]sx?$/i.test(source.fileName);
  for(const statement of source.statements){if(!ts.isExpressionStatement(statement)||!ts.isStringLiteral(statement.expression))break;const text=statement.expression.getText(source);if(text==='"use client"'||text==="'use client'")client=true;if(text==='"use server"'||text==="'use server'")server=true;}
  if(client&&server)throw new ModuleBoundaryError('CONFLICTING_MODULE_DIRECTIVES',[source.fileName]);return client?'client':server?'server':'neutral';
}
function target(from:string,specifier:string,files:Map<string,BuildSource>){
  const base=path.posix.normalize(path.posix.join(path.posix.dirname(from),specifier));
  if(base.startsWith('../')||path.posix.isAbsolute(base))return undefined;
  const stem=base.replace(/\.[cm]?jsx?$/i,'');
  const candidates=[base,...['.ts','.tsx','.mts','.cts','.js','.jsx','.mjs','.cjs'].map(ext=>stem+ext),...['.ts','.tsx','.js','.mjs'].map(ext=>base+'/index'+ext)];
  return candidates.find(file=>files.has(file)&&SCRIPT.test(file));
}
function serverRoute(ts:typeof TypeScript,source:TypeScript.SourceFile,client:boolean){
  for(const statement of source.statements){
    if(ts.isExportAssignment(statement)&&!client)return true;
    const modifiers=ts.canHaveModifiers(statement)?ts.getModifiers(statement):undefined;
    if(!modifiers?.some(item=>item.kind===ts.SyntaxKind.ExportKeyword))continue;
    if(!client&&modifiers.some(item=>item.kind===ts.SyntaxKind.DefaultKeyword))return true;
    if(ts.isFunctionDeclaration(statement)&&/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(statement.name?.text??''))return true;
    if(ts.isVariableStatement(statement)&&statement.declarationList.declarations.some(item=>ts.isIdentifier(item.name)&&/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(item.name.text)))return true;
  }
  return false;
}
/** A closed local browser ESM graph; bare packages/dynamic specifiers require a future verified bundler contract. */
export function classifyModules(ts:typeof TypeScript,sources:readonly BuildSource[]):ModuleClassification{
  if(sources.length>5000||sources.reduce((sum,item)=>sum+Buffer.byteLength(item.source),0)>64*1024*1024||sources.some(item=>Buffer.byteLength(item.source)>1048576))throw new ModuleBoundaryError('MODULE_GRAPH_LIMIT',[]);
  const files=new Map(sources.filter(file=>SCRIPT.test(file.relative)&&!file.relative.endsWith('.d.ts')).map(file=>[normalize(file.relative),file]));
  const data=new Map<string,{file:BuildSource;declared:'server'|'client'|'neutral';info:ReturnType<typeof imports>}>(),edges=new Map<string,Map<string,string>>();
  for(const [file,item]of files){const tree=parsed(ts,item);let declared:'server'|'client'|'neutral'=directive(ts,tree);if(item.serverOnly||item.routeModule&&serverRoute(ts,tree,declared==='client')){if(declared==='client')throw new ModuleBoundaryError('CLIENT_MODULE_IN_SERVER_ROLE',[file]);declared='server';}const info=imports(ts,tree);data.set(file,{file:item,declared,info});const links=new Map<string,string>();for(const {specifier}of info.found)if(specifier.startsWith('.')){const resolved=target(file,specifier,files);if(resolved)links.set(specifier,resolved);}edges.set(file,links);}
  const clientEntries=[...data].filter(([,item])=>item.declared==='client'||item.file.publicPath!==undefined).map(([file])=>file).sort(),clientModules=new Set<string>();
  const visit=(file:string,chain:string[])=>{
    const item=data.get(file)!;const trace=[...chain,file];if(chain.length>=64)throw new ModuleBoundaryError('MODULE_IMPORT_DEPTH_LIMIT',trace);
    if(item.declared==='server')throw new ModuleBoundaryError('CLIENT_IMPORTS_SERVER_MODULE',trace);
    if(item.info.serverUse)throw new ModuleBoundaryError('CLIENT_USES_SERVER_GLOBAL',trace);
    if(item.info.dynamic)throw new ModuleBoundaryError('CLIENT_DYNAMIC_IMPORT_UNSUPPORTED',trace);
    if(clientModules.has(file))return;clientModules.add(file);
    for(const {specifier}of item.info.found){
      if(specifier.startsWith('.')){const resolved=edges.get(file)!.get(specifier);if(!resolved)throw new ModuleBoundaryError('CLIENT_LOCAL_IMPORT_NOT_IN_BUILD',[...trace,'<unresolved local import>']);visit(resolved,trace);}
      else{
        const safe=/^(?:node:)?[@\w./:-]{1,128}$/.test(specifier)?specifier:'<external import>';
        const denied=specifier.startsWith('node:')||builtins.has(specifier)||/^(?:db(?::|$)|@zeruxjs\/(?:db|auth|cache|security|files|email|queue)|zeruxjs(?:\/|$)|server-only$)/.test(specifier);
        throw new ModuleBoundaryError(denied?'CLIENT_IMPORTS_SERVER_SERVICE':'CLIENT_EXTERNAL_BUNDLER_REQUIRED',[...trace,safe]);
      }
    }
  };
  for(const entry of clientEntries)visit(entry,[]);
  // Follow shared helpers too: a server import must not smuggle in a browser entry.
  const checked=new Set<string>();
  const serverVisit=(file:string,chain:string[])=>{if(chain.length>=64)throw new ModuleBoundaryError('MODULE_IMPORT_DEPTH_LIMIT',[...chain,file]);if(data.get(file)?.declared==='client')throw new ModuleBoundaryError('SERVER_IMPORTS_CLIENT_ENTRY_UNSUPPORTED',[...chain,file]);if(checked.has(file))return;checked.add(file);for(const resolved of edges.get(file)!.values())serverVisit(resolved,[...chain,file]);};
  for(const [file]of data)if(!clientModules.has(file))serverVisit(file,[]);
  const modules=[...data].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([file,item])=>({path:file,declared:item.declared,environment:(clientModules.has(file)?checked.has(file)?'shared':'client':'server') as ModuleEnvironment,imports:[...edges.get(file)!.values()].sort(),hash:createHash('sha256').update(item.file.source).digest('hex')}));
  return {modules,clientEntries,clientModules,edges};
}
/** Recheck compiler output and replace only actual import literals with graph-owned asset IDs. */
export function rewriteClientModule(ts:typeof TypeScript,relative:string,source:string,files:readonly BuildSource[],ids:ReadonlyMap<string,string>,prefix='./'):string{
  const tree=parsed(ts,{relative,source}),info=imports(ts,tree);if(info.dynamic||info.serverUse)throw new ModuleBoundaryError('CLIENT_COMPILED_BOUNDARY_VIOLATION',[relative]);
  const lookup=new Map(files.map(file=>[normalize(file.relative),file]));const replacements:{start:number;end:number;value:string}[]=[];
  for(const entry of info.found){if(!entry.specifier.startsWith('.'))throw new ModuleBoundaryError('CLIENT_COMPILED_EXTERNAL_IMPORT',[relative,/^(?:node:)?[@\w./:-]{1,128}$/.test(entry.specifier)?entry.specifier:'<external import>']);const resolved=target(relative,entry.specifier,lookup),id=resolved&&ids.get(resolved);if(!id)throw new ModuleBoundaryError('CLIENT_COMPILED_IMPORT_UNRESOLVED',[relative]);replacements.push({...entry,value:JSON.stringify(prefix+id+'.js')});}
  let output=source;for(const entry of replacements.sort((a,b)=>b.start-a.start))output=output.slice(0,entry.start)+entry.value+output.slice(entry.end);return output;
}

/** Loader route discovery uses the same exact directive policy without executing browser entries. */
export function isClientModuleSource(ts:typeof TypeScript,relative:string,source:string):boolean { return directive(ts,parsed(ts,{relative,source}))==='client'; }
