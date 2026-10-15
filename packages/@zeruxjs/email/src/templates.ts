import type {EmailTemplate} from './types.js';
import {escapeHtml} from './html.js';
function replacement(path:string,data:Record<string,unknown>){
  let value:unknown=data;
  for(const key of path.split('.')){if(['__proto__','prototype','constructor'].includes(key))throw new TypeError('Forbidden placeholder');if(!value||typeof value!=='object'||!Object.prototype.hasOwnProperty.call(value,key)){value='';break;}value=(value as Record<string,unknown>)[key];}
  if(typeof value==='object')return '';return String(value??'');
}
export function interpolateTemplate(template:string,data:Record<string,unknown>,html=false):string{
  if(typeof template!=='string'||template.length>1_000_000)throw new RangeError('Invalid template length');
  return template.replace(/\{\{\s*([a-zA-Z_][\w]*(?:\.[a-zA-Z_]\w*)*)\s*\}\}/g,(_match,key:string)=>{const value=replacement(key,data);return html?escapeHtml(value):value;});
}
function validate(template:EmailTemplate){if(!/^[a-zA-Z0-9][a-zA-Z0-9_:-]{0,99}$/.test(template.id)||!template.subject||template.subject.length>998||(!template.html&&!template.text))throw new TypeError('Invalid email template');}
export function createTemplateRegistry(initial:EmailTemplate[]=[]){
  const templates=new Map<string,EmailTemplate>();
  const api={
    register(template:EmailTemplate){validate(template);if(templates.has(template.id))throw new Error(`Template exists: ${template.id}`);templates.set(template.id,structuredClone(template));},
    set(template:EmailTemplate){validate(template);templates.set(template.id,structuredClone(template));},
    get(id:string){const result=templates.get(id);return result?structuredClone(result):undefined;},
    delete(id:string){return templates.delete(id);},
    list(){return Array.from(templates.values(),t=>structuredClone(t));},
    render(id:string,data:Record<string,unknown>={}){const template=templates.get(id);if(!template)throw new Error(`Unknown email template: ${id}`);return {subject:interpolateTemplate(template.subject,data),html:template.html===undefined?undefined:interpolateTemplate(template.html,data,true),text:template.text===undefined?undefined:interpolateTemplate(template.text,data),layout:template.layout};}
  };
  for(const template of initial)api.register(template);
  return api;
}
export type EmailTemplateRegistry=ReturnType<typeof createTemplateRegistry>;
