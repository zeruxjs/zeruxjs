import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {createCacheHelper} from '@zeruxjs/cache-valkey';
test('actual iovalkey driver connects to a scoped RESP fixture and releases its socket',async()=>{
 const sockets=new Set(),values=new Map();
 const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer=Buffer.alloc(0);
 socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length){let position=0;const line=()=>{const end=buffer.indexOf('\r\n',position);if(end<0)throw 0;const value=buffer.toString('utf8',position,end);position=end+2;return value;};let args;
 try{const head=line();assert.equal(head[0],'*');args=[];for(let n=Number(head.slice(1));n--;){const size=Number(line().slice(1));if(buffer.length<position+size+2)throw 0;args.push(buffer.toString('utf8',position,position+size));position+=size+2;}}catch(error){if(error===0)return;socket.destroy(error);return;}buffer=buffer.subarray(position);
 const [command,key,value,...options]=args;switch(command.toLowerCase()){
 case 'info':{const info='redis_version:7.2.0\r\nloading:0\r\n';socket.write(`$${Buffer.byteLength(info)}\r\n${info}\r\n`);break;}
 case 'client':socket.write('+OK\r\n');break;
 case 'set':if(options.includes('NX')&&values.has(key)){socket.write('$-1\r\n');break;}values.set(key,value);socket.write('+OK\r\n');break;
 case 'get':{const result=values.get(key);socket.write(result===undefined?'$-1\r\n':`$${Buffer.byteLength(result)}\r\n${result}\r\n`);break;}
 case 'quit':socket.end('+OK\r\n');break;
 default:socket.write('-ERR fixture unsupported command\r\n');}
 }});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let helper;
 try{helper=await createCacheHelper({host:'127.0.0.1',port:server.address().port});await helper.set('normal',{text:'é'});assert.deepEqual(await helper.get('normal'),{text:'é'});await helper.set('normal',false,{ifAbsent:true});assert.deepEqual(await helper.get('normal'),{text:'é'});assert.equal(await helper.get('missing'),undefined);await helper.close();await helper.whenClosed();}
 finally{if(helper)await helper.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}assert.equal(server.listening,false);
});
