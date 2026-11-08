import { createServer, type IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import type { ProtocolGateway } from './gateway.js';
import type { TransportAdapter, TransportStartContext } from './lifecycle.js';
export interface TransportAuthorizationContext { readonly signal: AbortSignal; readonly remoteAddress: string | undefined }
export type TransportAuthorization = (request: IncomingMessage, context: TransportAuthorizationContext) => boolean | Promise<boolean>;
/** Application-owned listener, never process supervision. */
function listener() {
  const sockets=new Set<Socket>(), server=createServer();let closed:Promise<void>|undefined;
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  return {server,address(){const a=server.address();return a&&typeof a!=='string'?{host:a.address,port:a.port}:null;},
    async listen(context:TransportStartContext){
      if(context.signal.aborted)throw new Error('Transport cancelled');
      server.maxConnections=context.limits.maxConcurrent;
      server.requestTimeout=context.limits.timeoutMs;server.headersTimeout=context.limits.timeoutMs;
      await new Promise<void>((resolve,reject)=>{
        const finish=(error?:Error)=>{server.off('error',failed);server.off('listening',ready);context.signal.removeEventListener('abort',abort);if(error)reject(error);else resolve();};
        const failed=(e:Error)=>finish(e),ready=()=>finish(),abort=()=>{server.close();finish(new Error('Transport cancelled'));};
        server.once('error',failed);server.once('listening',ready);context.signal.addEventListener('abort',abort,{once:true});server.listen(context.bind.port,context.bind.host);
      });
    },close(){return closed??=new Promise<void>((resolve,reject)=>{for(const socket of sockets)socket.destroy();server.close(error=>error&&(error as NodeJS.ErrnoException).code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve());});}};
}
/** Owns the supplied gateway. Explicit authorization is required even on loopback. */
export function createHttpTransportAdapter(options:{gateway:ProtocolGateway;authorize:TransportAuthorization}):TransportAdapter & {address():{host:string;port:number}|null}{
  if(!options||typeof options.authorize!=='function'||typeof options.gateway?.handle!=='function')throw new TypeError('Invalid HTTP adapter');
  const owned=listener(),jobs=new Set<Promise<unknown>>(),controllers=new Set<AbortController>();let context:TransportStartContext|undefined,closing:Promise<void>|undefined;
  const stop=()=>closing??=(async()=>{for(const c of controllers)c.abort();options.gateway.close();await owned.close();await Promise.allSettled([...jobs]);await options.gateway.whenClosed();})();
  owned.server.on('request',(req,res)=>{
    if(!context||context.signal.aborted||jobs.size>=context.limits.maxConcurrent){res.writeHead(503).end();return;}
    const controller=new AbortController();controllers.add(controller);const abort=()=>controller.abort();res.once('close',abort);
    const timer=setTimeout(()=>{controller.abort();if(!res.destroyed&&!res.writableEnded)res.writeHead(504).end();},context.limits.timeoutMs);
    const job=(async()=>{try{
      if(await options.authorize(req,{signal:controller.signal,remoteAddress:req.socket.remoteAddress})!==true){if(!res.writableEnded)res.writeHead(403).end();return;}
      if(controller.signal.aborted)return;clearTimeout(timer);
      if(!await options.gateway.handle(req,res)&&!res.writableEnded)res.writeHead(404).end();
    }catch{if(!res.destroyed&&!res.writableEnded){if(res.headersSent)res.destroy();else res.writeHead(500).end();}}})();
    jobs.add(job);void job.finally(()=>{clearTimeout(timer);res.off('close',abort);controllers.delete(controller);jobs.delete(job);});
  });
  return {address:owned.address,async start(value){if(context)throw new Error('Already started');context=value;value.onDispose(stop);options.gateway.constrain(value.limits);options.gateway.validateBindings();await owned.listen(value);},health:()=>({ready:owned.server.listening&&!closing}),stop};
}
export interface WebSocketMessageContext extends TransportAuthorizationContext {readonly deadline:number;readonly binary:boolean;send(message:string|Uint8Array):Promise<void>}
export interface WebSocketTransportOptions {path:string;authorize:TransportAuthorization;allowedOrigins?:readonly string[];onMessage(message:Uint8Array,context:WebSocketMessageContext):void|Promise<void>;onError?(error:unknown):void}
/** ws enforces aggregate fragmented-message maxPayload. Compression and implicit identity forwarding are disabled. */
export function createWebSocketTransportAdapter(options:WebSocketTransportOptions):TransportAdapter & {address():{host:string;port:number}|null}{
  if(!options||!/^\/[A-Za-z0-9/_-]{0,127}$/.test(options.path)||typeof options.authorize!=='function'||typeof options.onMessage!=='function'||options.onError!==undefined&&typeof options.onError!=='function')throw new TypeError('Invalid WebSocket adapter');
  const origins=options.allowedOrigins?[...options.allowedOrigins]:[];
  if(origins.length>64||origins.some(v=>{try{return new URL(v).origin!==v;}catch{return true;}}))throw new TypeError('Invalid origins');
  const owned=listener(),jobs=new Set<Promise<unknown>>(),controllers=new Set<AbortController>();let context:TransportStartContext|undefined,wss:WebSocketServer|undefined,closing:Promise<void>|undefined;
  const report=(e:unknown)=>{try{options.onError?.(e);}catch{/* Diagnostics never own cleanup. */}};
  const stop=()=>closing??=(async()=>{for(const c of controllers)c.abort();for(const ws of wss?.clients??[])ws.terminate();const drained=wss?new Promise<void>(resolve=>wss!.close(()=>resolve())):Promise.resolve();await owned.close();await drained;await Promise.allSettled([...jobs]);})();
  owned.server.on('request',(_req,res)=>res.writeHead(404).end());
  owned.server.on('upgrade',(req,socket,head)=>{
    if(!context||context.signal.aborted||jobs.size>=context.limits.maxConcurrent||(wss?.clients.size??0)>=context.limits.maxConcurrent){socket.destroy();return;}
    const limits=context.limits,controller=new AbortController();controllers.add(controller);
    const abort=()=>controller.abort();socket.once('close',abort);const timer=setTimeout(()=>{controller.abort();socket.destroy();},limits.timeoutMs);
    const job=(async()=>{try{
      if(req.url!==options.path||req.headers.origin!==undefined&&!origins.includes(String(req.headers.origin))||await options.authorize(req,{signal:controller.signal,remoteAddress:req.socket.remoteAddress})!==true){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',()=>socket.destroy());return;}
      if(controller.signal.aborted||socket.destroyed)return;
      wss!.handleUpgrade(req,socket,head,ws=>{
        let busy=false;ws.on('error',report);ws.once('close',()=>controller.abort());
        ws.on('message',(data,binary)=>{
          if(busy||jobs.size>=limits.maxConcurrent){ws.close(1013,'Busy');return;}busy=true;
          const c=new AbortController();controllers.add(c);const cancel=()=>c.abort();controller.signal.addEventListener('abort',cancel,{once:true});if(controller.signal.aborted)cancel();
          const expiresAt=Date.now()+limits.timeoutMs;
          const deadline=setTimeout(()=>{c.abort();ws.terminate();},limits.timeoutMs);
          const task=(async()=>{try{
            const message=Array.isArray(data)?Buffer.concat(data):Buffer.from(data as ArrayBuffer);
            await options.onMessage(message,{binary,deadline:expiresAt,signal:c.signal,remoteAddress:req.socket.remoteAddress,async send(value){const size=typeof value==='string'?Buffer.byteLength(value):value.byteLength;if(c.signal.aborted||size>limits.maxMessageBytes||ws.bufferedAmount+size>limits.maxMessageBytes||ws.readyState!==WebSocket.OPEN)throw new Error('Send unavailable');await new Promise<void>((resolve,reject)=>ws.send(value,error=>error?reject(error):resolve()));}});
          }catch(e){report(e);ws.terminate();}finally{clearTimeout(deadline);controller.signal.removeEventListener('abort',cancel);controllers.delete(c);busy=false;}})();jobs.add(task);void task.finally(()=>jobs.delete(task));
        });
      });
    }catch(e){report(e);socket.destroy();}})();jobs.add(job);void job.finally(()=>{clearTimeout(timer);socket.off('close',abort);controllers.delete(controller);jobs.delete(job);});
  });
  return {address:owned.address,async start(value){if(context)throw new Error('Already started');context=value;value.onDispose(stop);wss=new WebSocketServer({noServer:true,maxPayload:value.limits.maxMessageBytes,perMessageDeflate:false});await owned.listen(value);},health:()=>({ready:owned.server.listening&&!closing}),stop};
}
