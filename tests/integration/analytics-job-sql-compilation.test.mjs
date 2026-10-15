// SQL compilation/driver result smoke tests, NOT live database tests.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSqlConnector} from '@zeruxjs/db-sql-core';
const context={connection:{slug:'reporting',connector:'sql',options:{},name:'Reporting'}};
for(const [label,dialect,result] of [
 ['PostgreSQL',{kind:'pg',quoteIdentifier:s=>`"${s}"`,placeholder:i=>`$${i}`,functions:{},supportsIfNotExistsIndex:true,autoIncrementKeyword:'GENERATED ALWAYS AS IDENTITY'},{rowCount:1}],
 ['MySQL',{kind:'mysql',quoteIdentifier:s=>`\`${s}\``,placeholder:()=> '?',functions:{},supportsIfNotExistsIndex:false,autoIncrementKeyword:'AUTO_INCREMENT'},{affectedRows:1}]
])test(`${label} version-checked UPDATE has atomic id+version WHERE and usable affected row count`,async()=>{
 const seen=[];
 const connector=createSqlConnector(dialect,{executor:(sql,params,operation)=>{seen.push({sql,params,op:operation.op});return result;}});
 const response=await connector.execute({op:'update',table:'analytics_events_reconcile_jobs',
  values:{version:5,payload_json:'{"version":5}'},where:{and:[
   {field:'id',operator:'eq',value:'backfill_2024'},
   {field:'version',operator:'eq',value:4}
  ]}},context);
 assert.equal(response.ok,true);
 assert.match(seen[0].sql,/UPDATE/);
 assert.match(seen[0].sql,/WHERE/);
 assert.match(seen[0].sql,/version/);
 assert.match(seen[0].sql,/id/);
 assert.deepEqual(seen[0].params.slice(-2),['backfill_2024',4]);
 assert.equal(response.affectedCount??response.rowCount,1);
});
