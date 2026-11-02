import test from 'node:test';import assert from 'node:assert/strict';import{createRequire}from'node:module';import{randomBytes}from'node:crypto';
const require=createRequire(import.meta.url),{createConnector}=require('../dist/index.js');
test('disposable MySQL pinned rollback, native counts and precision',{skip:!process.env.ZX_TEST_MYSQL_URL?'ZX_TEST_MYSQL_URL is not configured':false},async()=>{
 const mysql=require('mysql2/promise'),uri=new URL(process.env.ZX_TEST_MYSQL_URL);
 const options={host:uri.hostname,port:Number(uri.port||3306),user:decodeURIComponent(uri.username),password:decodeURIComponent(uri.password),database:decodeURIComponent(uri.pathname.slice(1)),supportBigNumbers:true,bigNumberStrings:true,decimalNumbers:false,multipleStatements:false};
 const table=`zx_mysql_${randomBytes(8).toString('hex')}`,pool=mysql.createPool(options),db=await createConnector({pool,affectedRowsMode:'matched'}),ctx={connection:{name:'live',slug:'live',connector:'mysql',options:{}}};
 try{
 await pool.query(`CREATE TABLE \`${table}\` (id BIGINT PRIMARY KEY, amount DECIMAL(30,10), revision INT) ENGINE=InnoDB`);
 const insert=await db.execute({op:'insert',table,values:{id:'9007199254740993',amount:'12345678901234567890.1234567890',revision:1}},ctx);assert.equal(insert.affectedCount,1);
 await assert.rejects(db.transaction(async tx=>{await tx.update({table,values:{revision:2}});throw new Error('rollback fixture');}));
 const selected=await db.execute({op:'select',table},ctx);assert.equal(selected.rows[0].id,'9007199254740993');assert.equal(selected.rows[0].amount,'12345678901234567890.1234567890');assert.equal(selected.rows[0].revision,1);
 const noop=await db.execute({op:'update',table,values:{revision:1}},ctx);assert.equal(noop.matchedCount,1);assert.equal(noop.changedCount,0);
 const miss=await db.execute({op:'update',table,values:{revision:2},where:{field:'revision',operator:'eq',value:9}},ctx);assert.equal(miss.affectedCount,0);
 }finally{try{await db.disconnect();}finally{try{await pool.query(`DROP TABLE IF EXISTS \`${table}\``);}finally{await pool.end();}}}
});
