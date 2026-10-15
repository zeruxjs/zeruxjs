import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { RouteStore } from '../../dist/portless/routes.js';
import { createProxyServer } from '../../dist/portless/proxy.js';
import { launchInstanceFleet } from '../../dist/portless/instance-fleet.js';
const code = String.raw`
const http=require('node:http');
const fs=require('node:fs');
if(process.env.FLEET_TEST_DIR && fs.existsSync(process.env.FLEET_TEST_DIR+'/block-'+process.env.PORT)) process.exit(4);
const port=Number(process.env.PORT);
const server=http.createServer((req,res)=>{
 if(req.url==='/health'){res.end('ok');return;}
 if(req.url==='/slow'){setTimeout(()=>res.end('slow'),180);return;}
 res.end('node:'+port);
});
server.listen(port,'127.0.0.1');
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`;
async function freePorts(count) {
  const sockets = Array.from({length:count},()=>net.createServer());
  try {await Promise.all(sockets.map(s=>new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve)})));
    return sockets.map(s=>s.address().port);
  } finally {await Promise.all(sockets.map(s=>new Promise(r=>s.close(r))));}
}
export async function fleetFixture(testFn, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'zsrv-scale-test-'));
  const store = new RouteStore(dir);
  const proxy = createProxyServer({ getRoutes:()=>store.loadRoutes(), proxyPort:0, onError:()=>{} });
  const ports = await freePorts(5);
  let fleet;
  try {
    await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(0,'127.0.0.1',resolve)});
    fleet = await launchInstanceFleet([process.execPath,'-e',code], {
      store,hostname:'scale.localhost', ports, replicas:2, connections:proxy.backendConnections,
      health:{path:'/health'}, healthIntervalMs:30000, readyTimeoutMs:2500,
      shutdownTimeoutMs:800, drainTimeoutMs:1000, replacementDelayMs:0,
      stdio:'ignore', env:{FLEET_TEST_DIR:dir}, ...extra,
    });
    return await testFn({store,proxy,ports,fleet,dir});
  } finally {
    await fleet?.stop().catch(()=>{});
    await new Promise(r=>proxy.close(r));
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
