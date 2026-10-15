import {tokenize} from './tokenizer.js';
import type {KnowledgeDocument,KnowledgeResult,KnowledgeSnapshot,KnowledgeOptions} from './types.js';
function clone(doc:KnowledgeDocument):KnowledgeDocument{return {id:doc.id,text:doc.text,title:doc.title,metadata:doc.metadata?{...doc.metadata}:undefined};}
export class DocumentKnowledgeBase {
 private docs=new Map<string,KnowledgeDocument>();private readonly stop:Set<string>;private readonly max:number;private readonly maxChars:number;
 constructor(options:KnowledgeOptions={}){this.stop=new Set((options.stopWords??[]).map(s=>s.toLocaleLowerCase()));this.max=options.maxDocuments??10000;this.maxChars=options.maxDocumentCharacters??1000000;if(!Number.isSafeInteger(this.max)||this.max<1||!Number.isSafeInteger(this.maxChars)||this.maxChars<1)throw new RangeError('Invalid document limit');}
 get size(){return this.docs.size;}
 add(doc:KnowledgeDocument):void {if(!doc||typeof doc.id!=='string'||!doc.id.trim()||typeof doc.text!=='string'||!doc.text.trim())throw new TypeError('Document id and text required');if(doc.id.length>256||doc.text.length>this.maxChars||doc.title && doc.title.length>1000||doc.metadata && (Object.keys(doc.metadata).length>100||Object.entries(doc.metadata).some(([k,v])=>['__proto__','constructor','prototype'].includes(k)||typeof v!=='string'||v.length>10000)))throw new TypeError('Invalid document fields');if(!this.docs.has(doc.id)&&this.docs.size>=this.max)throw new RangeError('Knowledge base is full');this.docs.set(doc.id,clone(doc));}
 addMany(docs:KnowledgeDocument[]):void {const replacement=new DocumentKnowledgeBase({stopWords:[...this.stop],maxDocuments:this.max,maxDocumentCharacters:this.maxChars});for(const doc of this.docs.values())replacement.add(doc);for(const doc of docs)replacement.add(doc);this.docs=new Map(replacement.docs);}
 remove(id:string){return this.docs.delete(id);} clear(){this.docs.clear();}
 get(id:string){const doc=this.docs.get(id);return doc?clone(doc):undefined;}
 list(){return [...this.docs.values()].map(clone);}
 search(query:string,limit=5):KnowledgeResult[]{if(!Number.isSafeInteger(limit)||limit<0||limit>1000)throw new RangeError('Invalid search limit');const terms=[...new Set(tokenize(query).filter(t=>!this.stop.has(t)))];if(!terms.length)return[];
 const docs=[...this.docs.values()];const frequencies=new Map<string,number>();const counts=docs.map(doc=>{const terms=tokenize(`${doc.title??''} ${doc.text}`);const set=new Set(terms);for(const term of set)frequencies.set(term,(frequencies.get(term)??0)+1);return {doc,terms};});
 return counts.map(({doc,terms:words})=>{let score=0;const count=new Map<string,number>();for(const word of words)count.set(word,(count.get(word)??0)+1);const title=new Set(tokenize(doc.title??''));for(const term of terms){const tf=count.get(term)??0;if(tf)score+=(1+Math.log(tf))*(Math.log(1+(docs.length-(frequencies.get(term)??0)+0.5)/((frequencies.get(term)??0)+0.5))+1)*(title.has(term)?2:1);}return {document:clone(doc),score};}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.document.id.localeCompare(b.document.id)).slice(0,limit);
 }
 context(query:string,limit=5,maxCharacters=10000):string{if(!Number.isSafeInteger(maxCharacters)||maxCharacters<0)throw new RangeError('Invalid context budget');const segments:string[]=[];let used=0;for(const {document} of this.search(query,limit)){const entry=`[${document.id}] ${document.title??''}\n${document.text}`;if(used+entry.length>maxCharacters)break;segments.push(entry);used+=entry.length+2;}return segments.join('\n\n');}
 snapshot():KnowledgeSnapshot{return {version:1,documents:this.list()};}
 restore(snapshot:KnowledgeSnapshot):void {if(snapshot?.version!==1||!Array.isArray(snapshot.documents)||snapshot.documents.length>this.max)throw new TypeError('Invalid knowledge snapshot');const replacement=new DocumentKnowledgeBase({stopWords:[...this.stop],maxDocuments:this.max,maxDocumentCharacters:this.maxChars});for(const doc of snapshot.documents)replacement.add(doc);this.docs=new Map(replacement.docs);}
}
export const createKnowledgeBase=(options?:KnowledgeOptions)=>new DocumentKnowledgeBase(options);
