import type {AnalyticsConnection,DatabaseResultLike} from './types.js';

export interface VersionedDocument {version:number}
export interface VersionedStore<T extends VersionedDocument> {load():Promise<T>;save(document:T,expectedVersion:number):Promise<boolean>}
export interface DocumentConnection extends AnalyticsConnection {
  update(operation:{table:string;values:Record<string,string|number>;where:{and:Array<{field:string;operator:'eq';value:string|number}>}}):DatabaseResultLike|Promise<DatabaseResultLike>;
}
/** A CAS-backed document store shared by dashboards across nodes.
 * Correctness requires a DB connector that implements atomic conditional UPDATE and affectedCount.
 */
export function createDatabaseDocumentStore<T extends VersionedDocument>(connection:DocumentConnection,table:string,documentId:string,initial:T):VersionedStore<T>{
  if(!/^[a-z][a-z0-9_]{0,62}$/.test(table)||!/^[A-Za-z0-9_.:-]{1,90}$/.test(documentId))throw new TypeError('Invalid document store identity');
  let initialized:Promise<void>|undefined;
  const ensure=()=>initialized??=(async()=>{
    const result=await connection.createTable({table,ifNotExists:true,columns:[
      {name:'id',type:'varchar',length:96,primary:true,notNull:true},
      {name:'version',type:'bigint',notNull:true},{name:'payload_json',type:'text',notNull:true}
    ]});
    if(!result?.ok)throw new Error('Versioned document storage unavailable');
  })().catch(error=>{initialized=undefined;throw error;});
  async function lookup():Promise<T|undefined>{
    const res=await connection.select({table,columns:['id','version','payload_json'],where:{field:'id',operator:'eq',value:documentId},limit:1});
    if(!res?.ok)throw new Error('Versioned document read unavailable');
    const row=(res.rows??[])[0] as {payload_json?:unknown;version?:unknown}|undefined;
    if(!row)return undefined;
    if(typeof row.payload_json!=='string')throw new Error('Invalid stored document');
    const value=JSON.parse(row.payload_json) as T;
    if(typeof value?.version!=='number'||value.version!==Number(row.version))throw new Error('Stored document version mismatch');
    return value;
  }
  return {
    async load(){
      await ensure();let value=await lookup();if(value)return structuredClone(value);
      const created=await connection.insert({table,values:{id:documentId,version:initial.version,payload_json:JSON.stringify(initial)}});
      if(created?.ok)return structuredClone(initial);
      // Concurrent replica may have won insert; never erase it.
      value=await lookup();if(value)return structuredClone(value);
      throw new Error('Unable to initialize document store');
    },
    async save(document,expected){
      if(!Number.isSafeInteger(expected)||expected<1||document.version!==expected+1)return false;
      await ensure();
      const result=await connection.update({table,values:{version:document.version,payload_json:JSON.stringify(document)},where:{and:[{field:'id',operator:'eq',value:documentId},{field:'version',operator:'eq',value:expected}]}});
      if(!result?.ok)throw new Error('Versioned document update unavailable');
      const affected=(result as DatabaseResultLike & {affectedCount?:number;rowCount?:number}).affectedCount??(result as DatabaseResultLike & {rowCount?:number}).rowCount;
      if(affected===undefined)throw new Error('Connector lacks affectedCount for atomic compare-and-swap');
      return affected===1;
    }
  };
}
