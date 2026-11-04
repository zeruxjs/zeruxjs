import { attributeOwner } from './ownership.js';
export interface ComponentA11yProps {
 label?:string;labelledBy?:string;describedBy?:string;controls?:string;owns?:string;activeDescendant?:string;
 role?:string;disabled?:boolean;expanded?:boolean;selected?:boolean;
}
/** Explicit component names; neither branch invents a name from arbitrary text. */
export type LabelledComponentProps=ComponentA11yProps&({label:string;labelledBy?:never}|{label?:never;labelledBy:string});
export interface AccessibilityIssue { readonly code:'INVALID_PROP'|'MISSING_LABEL'|'AMBIGUOUS_LABEL'|'MISSING_ID'|'DUPLICATE_ID'|'INVALID_RELATIONSHIP'|'CONFLICTING_ROLE'|'POSITIVE_TABINDEX';readonly property:string }
export interface ComponentValidationOptions {root?:Document|ShadowRoot|HTMLElement;requireLabel?:boolean;maxElements?:number}
export class AccessibilityValidationError extends TypeError {
 readonly issues:readonly AccessibilityIssue[];
 constructor(issues:readonly AccessibilityIssue[]){super('Invalid accessibility component props');this.name='AccessibilityValidationError';this.issues=Object.freeze([...issues]);}
}
const attributes:Record<string,string>={label:'aria-label',labelledBy:'aria-labelledby',describedBy:'aria-describedby',controls:'aria-controls',owns:'aria-owns',activeDescendant:'aria-activedescendant',role:'role',expanded:'aria-expanded',selected:'aria-selected'};
const idProps=['labelledBy','describedBy','controls','owns','activeDescendant'];
/** Validate explicit props and ID relationships without modifying the DOM or reading label text.
 * References resolve only inside the supplied/root tree. This is not a full accessible-name/ARIA engine.
 */
export function validateComponentProps(element:HTMLElement,input:ComponentA11yProps,options:ComponentValidationOptions={}):readonly AccessibilityIssue[] {
 const issues:AccessibilityIssue[]=[];
 const report=(code:AccessibilityIssue['code'],property:string)=>issues.push(Object.freeze({code,property}));
 if((((!element||(typeof element.getAttribute!=='function'))||!input)||(typeof input!=='object'))||![null,Object.prototype].includes(Object.getPrototypeOf(input))){report('INVALID_PROP','props');return Object.freeze(issues);}
 const descriptors=Object.getOwnPropertyDescriptors(input);
 if((Object.keys(descriptors).length>16)||Object.getOwnPropertySymbols(input).length){report('INVALID_PROP','props');return Object.freeze(issues);}
 const props:Record<string,unknown>=Object.create(null);
 for(const [name,descriptor] of Object.entries(descriptors)){
  if(!Object.hasOwn(descriptor,'value')||(!Object.hasOwn(attributes,name)&&(name!=='disabled'))){report('INVALID_PROP',name);continue;}
  const value=descriptor.value;if(value===undefined)continue;
  if(['disabled','expanded','selected'].includes(name)?(typeof value!=='boolean'):((((typeof value!=='string')||!value.trim())||(value.length>1024))||/[\u0000-\u001f\u007f]/.test(value))){report('INVALID_PROP',name);continue;}
  props[name]=value;
 }
 const label=props.label??element.getAttribute('aria-label'),labelledBy=props.labelledBy??element.getAttribute('aria-labelledby');
 if((options.requireLabel&&!String(label??'').trim())&&!String(labelledBy??'').trim())report('MISSING_LABEL','label');
 if((props.label!==undefined)&&(props.labelledBy!==undefined))report('AMBIGUOUS_LABEL','label');
 if(((props.role!==undefined)&&element.hasAttribute('role'))&&(element.getAttribute('role')!==props.role))report('CONFLICTING_ROLE','role');
 if(element.tabIndex>0)report('POSITIVE_TABINDEX','tabindex');
 const max=options.maxElements??10000;
 if((!Number.isSafeInteger(max)||(max<1))||(max>50000))throw new RangeError('Invalid accessibility DOM budget');
 const root=options.root??element.getRootNode() as Document|ShadowRoot|HTMLElement;
 const references=new Map<string,HTMLElement[]>();
 const requested=idProps.filter(name=>(props[name]!==undefined)||element.hasAttribute(attributes[name]));
 if(requested.length){
  if(!root||(typeof root.querySelectorAll!=='function'))throw new TypeError('A DOM reference root is required');
  const found=root.querySelectorAll<HTMLElement>('[id]');if(found.length>max)throw new RangeError('Accessibility DOM budget exceeded');
  const nodes=[...found];if(('getAttribute' in root)&&(root as HTMLElement).hasAttribute('id'))nodes.unshift(root as HTMLElement);
  for(const node of nodes){const id=node.getAttribute('id')!;const list=references.get(id)??[];list.push(node);references.set(id,list);}
 }
 const resolved=new Map<string,HTMLElement[]>();
 for(const name of requested){
  const value=String((props[name]??element.getAttribute(attributes[name]))??'');
  const ids=value.trim().split(/\s+/);
  if(((((!value.trim()||(value.length>1024))||(ids.length>32))||(new Set(ids).size!==ids.length))||ids.some(id=>id.length>128))||((name==='activeDescendant')&&(ids.length!==1))){report('INVALID_PROP',name);continue;}
  const targets:HTMLElement[]=[];
  for(const id of ids){const matches=references.get(id)??[];if(matches.length===0)report('MISSING_ID',name);else if(matches.length>1)report('DUPLICATE_ID',name);else targets.push(matches[0]);}
  resolved.set(name,targets);
 }
 const active=resolved.get('activeDescendant')?.[0];
 if(active){const owned=[...(resolved.get('owns')??[]),...(((element.getAttribute('role')==='combobox')||(props.role==='combobox'))?(resolved.get('controls')??[]):[])];
  if((active===element)||(!element.contains(active)&&!owned.some(node=>(node===active)||node.contains(active))))report('INVALID_RELATIONSHIP','activeDescendant');
 }
 return Object.freeze(issues);
}
/** Validate then apply owned attributes. Native disabled attributes remain native; custom disabled
 * activation is capture-blocked for click/Enter/Space. This is UI behavior, never authorization.
 */
export function applyComponentProps(element:HTMLElement,props:ComponentA11yProps,options:ComponentValidationOptions={}) {
 const issues=validateComponentProps(element,props,options);if(issues.length)throw new AccessibilityValidationError(issues);
 const owner=attributeOwner();
 for(const [name,value] of Object.entries(props))if((name!=='disabled')&&(value!==undefined))owner.set(element,attributes[name],String(value));
 const native=/^(BUTTON|INPUT|SELECT|TEXTAREA|OPTION|OPTGROUP|FIELDSET)$/.test(element.tagName);
 if(props.disabled!==undefined){owner.set(element,'aria-disabled',String(props.disabled));if(native)owner.set(element,'disabled',props.disabled?'':null);}
 const disabled=props.disabled;
 const block=(event:Event)=>{if(disabled&&((event.type==='click')||['Enter',' '].includes((event as KeyboardEvent).key))){event.preventDefault();event.stopImmediatePropagation();}};
 if(props.disabled&&!native){element.addEventListener('click',block,true);element.addEventListener('keydown',block,true);element.addEventListener('keyup',block,true);}
 let disposed=false;
 return {destroy(){if(disposed)return;disposed=true;element.removeEventListener('click',block,true);element.removeEventListener('keydown',block,true);element.removeEventListener('keyup',block,true);owner.release();}};
}
export function applyLabelledComponentProps(element:HTMLElement,props:LabelledComponentProps,options:ComponentValidationOptions={}) {if(!props||((Object.getOwnPropertyDescriptor(props,'label')?.value===undefined)&&(Object.getOwnPropertyDescriptor(props,'labelledBy')?.value===undefined)))throw new AccessibilityValidationError([Object.freeze({code:'MISSING_LABEL',property:'label'})]);return applyComponentProps(element,props,{...options,requireLabel:true});}
