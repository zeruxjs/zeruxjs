// Small deterministic DOM harness for lifecycle tests. Not a replacement for a real browser.
export class NodeFake {
 constructor(doc,type,name=''){this.ownerDocument=doc;this.nodeType=type;this.nodeName=name;this.parentNode=null;this.childNodes=[];this.data='';this.attributes=new Map();this.listeners=new Map();this.value='';this.checked=false;this.selected=false;this.style={cssText:'',setProperty:(key,v)=>{this.style[key]=v}}}
 get nextSibling(){if(!this.parentNode)return null;const all=this.parentNode.childNodes;return all[all.indexOf(this)+1]??null}
 get textContent(){if(this.nodeType===3||this.nodeType===8)return this.data;return this.childNodes.filter(child=>child.nodeType!==8).map(child=>child.textContent).join('')}
 set textContent(value){if(this.nodeType===3||this.nodeType===8)this.data=String(value);else {for(const node of this.childNodes)node.parentNode=null;this.childNodes=[];if(value)this.appendChild(this.ownerDocument.createTextNode(value))}}
 insertBefore(node,anchor){if(node===anchor)return node;if(anchor&&!this.childNodes.includes(anchor))throw new Error('wrong anchor');node.parentNode?.removeChild(node);this.childNodes.splice(anchor?this.childNodes.indexOf(anchor):this.childNodes.length,0,node);node.parentNode=this;return node}
 appendChild(node){return this.insertBefore(node,null)}
 removeChild(node){const index=this.childNodes.indexOf(node);if(index<0)throw new Error('missing child');this.childNodes.splice(index,1);node.parentNode=null;return node}
 setAttribute(key,value){this.attributes.set(key,String(value))}
 removeAttribute(key){this.attributes.delete(key)}
 getAttribute(key){return this.attributes.get(key)??null}
 addEventListener(event,handler){const current=this.listeners.get(event)??new Set();current.add(handler);this.listeners.set(event,current)}
 removeEventListener(event,handler){this.listeners.get(event)?.delete(handler)}
 dispatch(type){for(const handler of this.listeners.get(type)??[])handler({type,target:this})}
}
export class DocumentFake extends NodeFake {
 constructor(){super(null,9,'#document');this.ownerDocument=this}
 createElement(name){return new NodeFake(this,1,name.toUpperCase())}
 createTextNode(text){const node=new NodeFake(this,3,'#text');node.data=String(text);return node}
 createComment(text){const node=new NodeFake(this,8,'#comment');node.data=String(text);return node}
}
export const root = ()=>{const doc=new DocumentFake();return doc.createElement('div')};
