import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEmailManager} from '../dist/index.js';
test('email instrumentation is opt-in and telemetry failure does not duplicate delivered mail',async()=>{
  const sent=[],tracked=[];
  const manager=createEmailManager({accounts:[{name:'primary',transport:{async sendMail(data){sent.push(data);return {messageId:'mail-1',accepted:['reader@example.net']};}},defaults:{from:'sender@example.net'}}],
    tracking:{async instrumentHtml(html,c){tracked.push({name:'instrument',c});return html.replace('</body>','<img src="https://events.example/pixel" /></body>');},async onSent(c){tracked.push({name:'sent',c});throw new Error('DB down');}},onTrackingError:()=>tracked.push({name:'failure'})});
  await manager.send({to:'reader@example.net',subject:'No tracking',text:'Hi',html:'<body>Hi</body>'},{htmlMode:'trusted'});
  await manager.send({to:'reader@example.net',subject:'Tracked',text:'Hi',html:'<body>Hi</body>',tracking:{enabled:true}},{htmlMode:'trusted'});
  assert.equal(sent.length,2);assert.doesNotMatch(sent[0].html,/pixel/);assert.match(sent[1].html,/pixel/);
  assert.deepEqual(tracked.map(x=>x.name),['instrument','sent','failure']);
  await manager.close();
});
