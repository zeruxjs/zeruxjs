import type {Rule} from 'eslint';
import {literal,key,imported,type Node} from './rule-ast.js';
const attr=(node:Node,name:string)=>node.attributes.find((item:Node)=>item.type==='JSXAttribute'&&item.name.name===name);
const value=(attribute:Node)=>attribute?.value?.type==='JSXExpressionContainer'?literal(attribute.value.expression):literal(attribute?.value);
const unknown=(attribute:Node)=>attribute&&value(attribute)===undefined;
const namedRoles=new Set(['dialog','alertdialog']);
/** Static checks intentionally avoid cross-component DOM assumptions and accessible-name synthesis. */
export const accessibilityRules:Record<string,Rule.RuleModule>={
 'a11y-required-label':{
  meta:{type:'problem',schema:[],messages:{label:'This explicitly labelled component/dialog requires a non-empty label or labelled-by reference. Supply its authored name; do not derive one from arbitrary text.'}},
  create(context){return {
   CallExpression(node:Node){
    const binding=imported(context,node.callee);if(binding?.source!=='@zeruxjs/accessibility'||binding.name!=='applyLabelledComponentProps')return;
    const props=node.arguments[1];if(props?.type!=='ObjectExpression'||props.properties.some((item:Node)=>item.type==='SpreadElement'||item.computed))return;
    const names=props.properties.filter((item:Node)=>['label','labelledBy'].includes(key(item)??''));
    if(names.some((item:Node)=>literal(item.value)===undefined))return;
    if(!names.some((item:Node)=>literal(item.value)?.trim()))context.report({node:props,messageId:'label'});
   },
   JSXOpeningElement(node:Node){
    if(node.name.type!=='JSXIdentifier'||!/^[a-z]/.test(node.name.name)||node.attributes.some((item:Node)=>item.type==='JSXSpreadAttribute'))return;
    const role=value(attr(node,'role'));if(!namedRoles.has(role??''))return;
    const names=['aria-label','aria-labelledby','title'].map(name=>attr(node,name));
    if(names.some(unknown))return;
    if(!names.some(item=>value(item)?.trim()))context.report({node,messageId:'label'});
   },
  };},
 },
 'a11y-relationships':{
  meta:{type:'problem',schema:[],messages:{reference:'Use a non-empty, whitespace-separated ARIA ID reference (one ID for aria-activedescendant). Validate actual target existence at mount time.',self:'aria-activedescendant must identify a related active descendant, not the owner itself.',duplicate:'Duplicate literal IDs in the same unconditional JSX subtree make ID relationships ambiguous.',tab:'Use native order or zero/-1 tabindex; positive tabindex must not manufacture a component tab order.'}},
  create(context){
   const groups=new Map<Node,Map<string,Node[]>>();
   return {
    JSXOpeningElement(node:Node){
     if(node.name.type!=='JSXIdentifier'||!/^[a-z]/.test(node.name.name)||node.attributes.some((item:Node)=>item.type==='JSXSpreadAttribute'))return;
     const own=value(attr(node,'id'));
     for(const name of ['aria-labelledby','aria-describedby','aria-controls','aria-owns','aria-activedescendant']){
      const attribute=attr(node,name),text=value(attribute);if(!attribute||text===undefined)continue;
      if(!text.trim()||/[\u0000-\u001f\u007f]/.test(text)||name==='aria-activedescendant'&&text.trim().split(/\s+/).length!==1)context.report({node:attribute,messageId:'reference'});
      else if(name==='aria-activedescendant'&&own&&own===text.trim())context.report({node:attribute,messageId:'self'});
     }
     const tab=attr(node,'tabIndex')??attr(node,'tabindex'),tabNode=tab?.value?.type==='JSXExpressionContainer'?tab.value.expression:tab?.value;
     const number=tabNode?.type==='Literal'?Number(tabNode.value):undefined;
     if(number!==undefined&&Number.isFinite(number)&&number>0)context.report({node:tab,messageId:'tab'});
     if(!own)return;
     let root=node.parent;
     // Stop at expressions/components; conditional/repeated render branches cannot prove uniqueness.
     while(root?.parent&&['JSXElement','JSXFragment'].includes(root.parent.type)){const parent=root.parent;if(parent.type==='JSXElement'&&(parent.openingElement.name.type!=='JSXIdentifier'||!/^[a-z]/.test(parent.openingElement.name.name)))break;root=parent;}
     let ids=groups.get(root);if(!ids){ids=new Map();groups.set(root,ids);}const entries=ids.get(own)??[];entries.push(node);ids.set(own,entries);
    },
    'Program:exit'(){for(const ids of groups.values())for(const entries of ids.values())if(entries.length>1)for(const node of entries)context.report({node,messageId:'duplicate'});},
   };
  },
 },
};
