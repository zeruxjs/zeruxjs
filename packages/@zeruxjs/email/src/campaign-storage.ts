import type {CampaignState,CampaignStore} from './campaigns.js';

export interface CampaignDatabaseResult {ok:boolean;rows?:unknown[];affectedCount?:number;rowCount?:number}
/** Narrow @zeruxjs/db adapter contract; writes need atomic affectedCount. */
export interface CampaignDatabaseConnection {
  /** Connector input shapes are validated by @zeruxjs/db; use generic structural operations here. */
  createTable(input:any):Promise<CampaignDatabaseResult>|CampaignDatabaseResult;
  insert(input:any):Promise<CampaignDatabaseResult>|CampaignDatabaseResult;
  select(input:any):Promise<CampaignDatabaseResult>|CampaignDatabaseResult;
  update(input:any):Promise<CampaignDatabaseResult>|CampaignDatabaseResult;
  delete?(input:any):Promise<CampaignDatabaseResult>|CampaignDatabaseResult;
  createIndex?(input:any):Promise<CampaignDatabaseResult>|CampaignDatabaseResult;
}
/** Shared JSON document store. Atomic insert and versioned update are mandatory. */
export function createDatabaseCampaignStore(db:CampaignDatabaseConnection,table='zerux_email_campaigns'):CampaignStore{
  if(!/^[a-z][a-z0-9_]{0,62}$/.test(table))throw new TypeError('Invalid campaign table name');
  let initializing:Promise<void>|undefined;
  const ensure=()=>initializing??=(async()=>{
    const result=await db.createTable({table,ifNotExists:true,columns:[
      {name:'id',type:'varchar',length:96,primary:true,notNull:true},
      {name:'version',type:'bigint',notNull:true},
      {name:'payload_json',type:'text',notNull:true}
    ]});
    if(!result?.ok)throw new Error('Campaign table initialization failed');
  })().catch(e=>{initializing=undefined;throw e;});
  const encoded=(state:CampaignState)=>{
    const json=JSON.stringify(state);
    // Portable SQL TEXT (including MySQL's 64 KiB TEXT) requires a conservative bound.
    if(Buffer.byteLength(json)>60_000)throw new RangeError('Campaign checkpoint exceeds portable TEXT limit; lower batchSize');
    return json;
  };
  async function load(id:string):Promise<CampaignState|null>{
    await ensure();
    const result=await db.select({table,columns:['id','version','payload_json'],where:{field:'id',operator:'eq',value:id},limit:1});
    if(!result?.ok)throw new Error('Campaign read failed');
    const row=result.rows?.[0] as Record<string,unknown>|undefined;if(!row)return null;
    if(typeof row.payload_json!=='string')throw new Error('Corrupt campaign document');
    const parsed=JSON.parse(row.payload_json) as CampaignState;
    if(parsed?.id!==id||!Number.isSafeInteger(parsed.version)||parsed.version!==Number(row.version))throw new Error('Campaign document version mismatch');
    return parsed;
  }
  return {
    async load(id){return load(id);},
    async create(state){
      await ensure();
      try{const result=await db.insert({table,values:{id:state.id,version:state.version,payload_json:encoded(state)}});if(result?.ok)return true;}
      catch(e){if(await load(state.id))return false;throw e;}
      if(await load(state.id))return false;
      throw new Error('Campaign creation failed');
    },
    async save(state,expected){
      if(!Number.isSafeInteger(expected)||expected<1||state.version!==expected+1)return false;
      await ensure();
      const result=await db.update({table,values:{version:state.version,payload_json:encoded(state)},where:{and:[{field:'id',operator:'eq',value:state.id},{field:'version',operator:'eq',value:expected}]}});
      if(!result?.ok)throw new Error('Campaign checkpoint write failed');
      const affected=result.affectedCount??result.rowCount;
      if(affected===undefined)throw new Error('Campaign store connector missing affectedCount');
      if(!Number.isSafeInteger(affected)||affected<0||affected>1)throw new Error('Invalid campaign CAS result');
      return affected===1;
    }
  };
}
