import type {Rule} from 'eslint';
// ESLint and TypeScript-ESTree share these visited node shapes. Parser-owned nodes are never mutated.
export type Node = any;
export const literal=(node:Node):string|undefined=>node?.type==='Literal'&&typeof node.value==='string'?node.value:node?.type==='TemplateLiteral'&&!node.expressions.length?node.quasis[0]?.value.cooked:undefined;
export const key=(node:Node):string|undefined=>!node.computed&&node.key?.type==='Identifier'?node.key.name:literal(node.key);
export function unwrap(node:Node):Node {while(node&&['AwaitExpression','ChainExpression','TSAsExpression','TSNonNullExpression','TSSatisfiesExpression'].includes(node.type))node=node.argument??node.expression;return node;}
export function variable(context:Rule.RuleContext,node:Node):any {
 let scope:any=context.sourceCode.getScope(node);
 while(scope){const found=scope.set.get(node.name);if(found)return found;scope=scope.upper;}
}
export function imported(context:Rule.RuleContext,node:Node):{source:string;name:string}|undefined {
 if(node?.type==='Identifier'){
  const definition=variable(context,node)?.defs[0];
  if(definition?.type==='ImportBinding')return {source:String(definition.parent.source.value),name:definition.node.type==='ImportNamespaceSpecifier'?'*':definition.node.imported?.name??'default'};
 }
 if(node?.type==='MemberExpression'&&!node.computed){const owner=imported(context,node.object);if(owner?.name==='*')return {source:owner.source,name:node.property.name};}
}
