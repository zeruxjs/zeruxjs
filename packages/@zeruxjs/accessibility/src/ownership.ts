/** Compare-and-restore attribute ownership; preserve changes made by the host while active. */
export function attributeOwner() {
 const records=new Map<Element,Map<string,{before:string|null;applied:string|null}>>();
 const restore=(element:Element,name:string,record:{before:string|null;applied:string|null})=>{
  if(element.getAttribute(name)!==record.applied)return;
  if(record.before===null)element.removeAttribute(name);else element.setAttribute(name,record.before);
 };
 return {
  set(element:Element,name:string,value:string|null){
   let attributes=records.get(element);if(!attributes){attributes=new Map();records.set(element,attributes);}
   const current=element.getAttribute(name),old=attributes.get(name);
   const record=old&&current===old.applied?old:{before:current,applied:current};record.applied=value;attributes.set(name,record);
   if(value===null)element.removeAttribute(name);else element.setAttribute(name,value);
  },
  release(element?:Element){
   for(const [target,attributes] of records){if(element&&target!==element)continue;for(const [name,record] of attributes)restore(target,name,record);records.delete(target);}
  },
 };
}
