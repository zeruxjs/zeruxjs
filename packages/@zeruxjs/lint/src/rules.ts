import { builtinModules } from 'node:module';
import type { ESLint, Rule } from 'eslint';
import type { extractMessages } from 'zlocale/build';
import { deniedSubpath } from './contracts.js';
import type { PackageExportContract } from './contracts.js';
import {literal,key,unwrap,variable,imported,type Node} from './rule-ast.js';
import {accessibilityRules} from './rules-accessibility.js';
const coreModules=new Set(builtinModules.map(name=>name.replace(/^node:/,'')));
const metadata=(description:string,messages:Record<string,string>):Rule.RuleMetaData=>({type:'problem',docs:{description},schema:[],messages});
const property=(node:Node,name:string)=>node?.type==='ObjectExpression'?node.properties.find((item:Node)=>item.type==='Property'&&key(item)===name)?.value:undefined;
const sensitive=/(password|secret|token|credential|authorization|private|salt|key|dsn|connectionstring)/i;
function serverImport(specifier:string):boolean {
 return specifier.startsWith('node:')||coreModules.has(specifier)||specifier==='server-only'||/(?:^|\/)\w[^/]*\.server(?:\.[cm]?[jt]sx?)?$/.test(specifier)||
 /^(?:@zeruxjs\/(?:db(?:-[\w-]+)?|auth|files|email|queue(?:-[\w-]+)?)(?:\/|$)|@zeruxjs\/validator\/http$|zlocale\/(?:node|build)$|zuixs\/node$|zhost(?:\/|$)|zeruxjs(?:$|\/(?:services|database|cache-runtime|actions|action-stores|modules|service-endpoints|graphql|build|static-export)(?:\/|$))|@zeruxjs\/security(?:$|\/(?:crypto|jwt|policy)$))/.test(specifier);
}
const acquisitions:Record<string,readonly string[]>={
 '@zeruxjs/accessibility':['createFocusTrap','createAccessibleDialog','createLiveAnnouncer','createRovingTabIndex','applyComponentProps','applyLabelledComponentProps'],
 zlook:['startWatcher','watchDirectory'],zlocale:['createCatalogLoader','createLocaleController'],
 'zlocale/browser':['createCatalogLoader','createLocaleController'],'zlocale/node':['createRequestI18n'],
 zuixs:['injectZuix'],'zuixs/node':['watchZuix'], '@zeruxjs/validator/browser':['createFormFeedback'],
};

/** Create isolated rules. Localization requires the actual zlocale extractor, supplied only by strict presets. */
export function createZeruxPlugin(contracts:readonly PackageExportContract[],extract?:typeof extractMessages):ESLint.Plugin {
 const rules:Record<string,Rule.RuleModule>={...accessibilityRules,
  'client-server-import':{
   meta:metadata('Reject direct server imports in explicit client modules',{denied:'This explicit client module imports a server-only module. Move the work behind a server handler or select a documented browser entry.'}),
   create(context){
    let client=false;
    const check=(node:Node,source:Node,typeOnly=false)=>{const text=literal(source);if(client&&!typeOnly&&text&&serverImport(text))context.report({node,messageId:'denied'});};
    return {
     Program(node:Node){client=/\.client\.[cm]?[jt]sx?$/.test(context.filename);for(const statement of node.body){if(statement.type!=='ExpressionStatement'||typeof statement.directive!=='string')break;if(statement.directive==='use client')client=true;}},
     ImportDeclaration(node:Node){check(node,node.source,node.importKind==='type'||node.specifiers.length>0&&node.specifiers.every((item:Node)=>item.importKind==='type'));},
     ExportNamedDeclaration(node:Node){if(node.source)check(node,node.source,node.exportKind==='type'||node.specifiers.length>0&&node.specifiers.every((item:Node)=>item.exportKind==='type'));},
     ExportAllDeclaration(node:Node){check(node,node.source,node.exportKind==='type');},
     ImportExpression(node:Node){check(node,node.source);},
     TSImportEqualsDeclaration(node:Node){if(node.moduleReference?.type==='TSExternalModuleReference')check(node,node.moduleReference.expression,node.importKind==='type');},
     CallExpression(node:Node){if(node.callee.type==='Identifier'&&node.callee.name==='require'&&!variable(context,node.callee)?.defs.length)check(node,node.arguments[0]);},
    };
   },
  },
  'cleanup-ownership':{
   meta:metadata('Reject immediately discarded owned resource/disposal handles',{dropped:'Retain or return this resource/disposal handle and close/dispose it at its owner lifecycle. Passing it to an explicit owner is also supported.'}),
   create(context){return {ExpressionStatement(node:Node){
    let call=unwrap(node.expression);if(call?.type==='UnaryExpression'&&call.operator==='void')call=unwrap(call.argument);
    if(call?.type!=='CallExpression')return;
    const binding=imported(context,call.callee);
    const factory=binding&&acquisitions[binding.source]?.includes(binding.name);
    const timer=call.callee.type==='Identifier'&&call.callee.name==='setInterval'&&!variable(context,call.callee)?.defs.length;
    if(factory||timer)context.report({node:call,messageId:'dropped'});
   }};},
  },
  'public-service-config':{
   meta:metadata('Reject statically visible non-public configuration data',{private:'Credential-like fields do not belong in public settings/publicFields. Keep them in privateOptions and expose an explicit safe projection.',executable:'Public settings must contain serializable data, not functions, accessors or class instances.',limit:'Public settings exceed the framework public configuration depth budget.'}),
   create(context){
    const inspect=(node:Node,depth=0)=>{
     node=unwrap(node);if(!node)return;
     if(depth>12){context.report({node,messageId:'limit'});return;}
     if(['ArrowFunctionExpression','FunctionExpression','NewExpression'].includes(node.type)||node.type==='Literal'&&(typeof node.value==='bigint'||node.regex)||node.type==='Identifier'&&['undefined','NaN','Infinity'].includes(node.name)&&!variable(context,node)?.defs.length){context.report({node,messageId:'executable'});return;}
     if(node.type==='ArrayExpression')for(const item of node.elements)inspect(item,depth+1);
     if(node.type==='ObjectExpression')for(const item of node.properties){
      if(item.type!=='Property')continue;
      const name=key(item);if(name&&sensitive.test(name))context.report({node:item,messageId:'private'});
      if(item.method||item.kind==='get'||item.kind==='set')context.report({node:item,messageId:'executable'});else inspect(item.value,depth+1);
     }
    };
    const config=(node:Node)=>{const value=property(node,'publicSettings');if(value)inspect(value);};
    return {
     CallExpression(node:Node){const binding=imported(context,node.callee);if(!binding||!['zeruxjs','zeruxjs/services'].includes(binding.source))return;
      if(binding.name==='createApplicationLifecycle')config(property(node.arguments[0],'config'));
      if(binding.name==='createServiceScope')inspect(node.arguments[0]);
      if(binding.name==='defineService'){const fields=property(node.arguments[0],'publicFields');if(fields?.type==='ArrayExpression')for(const field of fields.elements){const value=literal(field);if(value&&sensitive.test(value))context.report({node:field,messageId:'private'});}}
     },
     ExportDefaultDeclaration(node:Node){if(/(?:^|[/\\])zerux\.config\.[cm]?[jt]s$/.test(context.filename))config(node.declaration);},
    };
   },
  },
  'package-exports':{
   meta:metadata('Reject imports absent or explicitly denied in selected installed export maps',{unsupported:'This subpath is not public in the selected installed package export map. Use a documented public entry; source-only paths are not a consumer contract.'}),
   create(context){const check=(node:Node,source:Node)=>{const name=literal(source);if(name&&deniedSubpath(name,contracts))context.report({node,messageId:'unsupported'});};return {
    TSImportEqualsDeclaration(node:Node){if(node.moduleReference?.type==='TSExternalModuleReference')check(node,node.moduleReference.expression);},
    TSImportType(node:Node){check(node,node.argument?.type==='TSLiteralType'?node.argument.literal:node.argument);},
    ImportDeclaration(node:Node){check(node,node.source);},ExportNamedDeclaration(node:Node){if(node.source)check(node,node.source);},ExportAllDeclaration(node:Node){check(node,node.source);},ImportExpression(node:Node){check(node,node.source);},
    CallExpression(node:Node){if(node.callee.type==='Identifier'&&node.callee.name==='require'&&!variable(context,node.callee)?.defs.length)check(node,node.arguments[0]);},
   };},
  },
 };
 if(extract)rules['locale-text-domain']={
  meta:metadata('Require extractable zlocale messages and an explicit literal text domain',{domain:'Declare a non-empty literal text domain on this call or on its createI18n owner.',message:'This zlocale call cannot be safely extracted. Use supported literal singular/context/plural/domain arguments; do not build keys dynamically.',limit:'Localization extraction exceeded its source budget; split this call/source before extraction.'}),
  create(context){
   const owner=(node:Node,depth=0):{domain?:string}|undefined=>{
    if(depth>8)return;node=unwrap(node);
    if(node?.type==='Identifier'){const definition=variable(context,node)?.defs[0];if(definition?.type==='Variable')return owner(definition.node.init,depth+1);}
    if(node?.type==='CallExpression'){
     const binding=imported(context,node.callee);
     if(binding&&['zlocale','zlocale/browser'].includes(binding.source)&&binding.name==='createI18n'){const domain=literal(property(node.arguments[0],'domain'));return domain?{domain}:{};}
     if(node.callee.type==='MemberExpression'&&!node.callee.computed&&node.callee.property.name==='forLocale')return owner(node.callee.object,depth+1);
    }
   };
   return {CallExpression(node:Node){
    const callee=node.callee;
    let method:string|undefined,domain:string|undefined,receivers:string[]=[];
    if(callee.type==='MemberExpression'&&!callee.computed&&callee.object.type==='Identifier'){
     const bound=owner(callee.object);if(!bound)return;method=callee.property.name;domain=bound.domain;receivers=[callee.object.name];
    }else if(callee.type==='Identifier'){
     const definition=variable(context,callee)?.defs[0];if(definition?.type!=='Variable'||definition.node.id.type!=='ObjectPattern')return;
     const binding=definition.node.id.properties.find((item:Node)=>item.type==='Property'&&item.value.type==='Identifier'&&item.value.name===callee.name);
     const bound=owner(definition.node.init);if(!binding||!bound)return;method=key(binding);domain=bound.domain;
    }
    if(!method||!['__','_x','_n','_nx'].includes(method))return;
    const index=method==='__'?1:method==='_x'?2:method==='_n'?3:4;
    const supplied=node.arguments[index];if(supplied)domain=literal(supplied);
    if(!domain?.trim())context.report({node,messageId:'domain'});
    try{
     const functions=callee.type==='Identifier'?{[callee.name]:method as '__'|'_x'|'_n'|'_nx'}:{};
     const result=extract(context.sourceCode.getText(node),{fileName:'lint.tsx',receivers,functions,...(domain?{defaultDomain:domain}:{})});
     if(result.diagnostics.length)context.report({node,messageId:'message'});
    }catch(error){context.report({node,messageId:error instanceof RangeError?'limit':'message'});}
   }};
  },
 };
 return {meta:{name:'@zeruxjs/lint'},rules};
}
