import assert from 'node:assert/strict';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { createI18n, createCatalogLoader, createLocaleController, defineCatalog, interpolate, sprintf, serializeCatalogs, parseCatalogs } from 'zlocale';
import { createRequestI18n } from 'zlocale/node';
import { extractMessages, createSourceExtractor, compressCatalogs } from 'zlocale/build';
import { escapeHtmlText, escapeHtmlAttribute, serializeJsonForScript, validateNavigationUrl } from 'zlocale/encoding';
const catalog = (locale = 'fr', messages = { Hello: 'Bonjour' }, domain = 'shop') => ({ locale, domain, messages });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('literal extraction retains domain/context/plural locations without evaluating source; dynamic and invalid calls diagnose', () => {
  const source = `throw new Error('must never execute');\n__("Hello", "shop"); t._nx('%d item','%d items', count, 'cart', 'shop');\n__(key); __(\`hello \${name}\`); other.__("no"); t['__']('no'); tr('Alias');`;
  const result = extractMessages(source, { receivers: ['t'], functions: { tr: '__' } });
  assert.deepEqual(result.messages.map(({singular, plural, context, domain}) => ({singular, plural, context, domain})), [
    { singular:'Hello', plural:undefined, context:undefined, domain:'shop' },
    { singular:'%d item', plural:'%d items', context:'cart', domain:'shop' },
    { singular:'Alias', plural:undefined, context:undefined, domain:'default' },
  ]);
  assert.equal(result.messages[0].line,2);
  assert.deepEqual(result.diagnostics.map(x=>x.code), ['DYNAMIC_KEY','DYNAMIC_KEY','INVALID_CALL','INVALID_CALL']);
  assert.equal(extractMessages('__("unterminated)').diagnostics[0].code, 'SYNTAX');
  assert.equal(extractMessages(`_n('%s item','%d items',n)`).diagnostics[0].code, 'INVALID_CALL');
  assert.throws(()=>extractMessages('__("large")', {maxBytes:2}), /byte limit/);
  assert.throws(()=>extractMessages('__("a");__("b")', {maxMessages:1}), /message limit/);
});

test('incremental extraction replaces changed sources, evicts bounded entries and supports removal', () => {
  const extractor = createSourceExtractor({maxEntries:1});
  const first = extractor.extract('a.ts','__("A")');
  assert.equal(extractor.extract('a.ts','__("A")'),first);
  assert.notEqual(extractor.extract('a.ts','__("B")'),first);
  extractor.extract('b.ts','__("C")');
  assert.notEqual(extractor.extract('a.ts','__("A")'),first);
  extractor.invalidate('a.ts'); extractor.clear();
});

test('translation placeholders cannot be removed, added or change numeric type; messages stay inert', () => {
  assert.throws(()=>defineCatalog(catalog('fr', {'Hi %{name}':'Salut'})), /placeholder mismatch/);
  assert.throws(()=>defineCatalog(catalog('fr', {'%d item':{one:'%s article',other:'%d articles'}})), /placeholder mismatch/);
  const c = defineCatalog(catalog('fr', {'%s has %d':'%2$d pour %1$s', 'Hello':'<script>bad()</script>'}));
  const t = createI18n({locale:'fr',domain:'shop',catalogs:[c]});
  assert.equal(sprintf(t.__('%s has %d'),'Ada',3),'3 pour Ada');
  assert.equal(t.__('Hello'),'<script>bad()</script>');
  assert.throws(()=>interpolate('Hi %{name}',{}), /missing interpolation/);
  assert.throws(()=>sprintf('%d','secret'), /requires number/);
  assert.throws(()=>t.formatNumber(NaN), /finite/);
  assert.throws(()=>t.formatDateTime(new Date(NaN)), /invalid date/);
  assert.throws(()=>t.formatRelativeTime(1,'invalid'), RangeError);
});

test('fallbacks remain locale ordered and domain isolated; native plurals and RTL use selected locale', () => {
  const i18n = createI18n({locale:'fr-CA',domain:'shop',fallbackLocales:['de'],catalogs:[
    catalog('fr',{Hello:'Salut'}),catalog('de',{Missing:'Fehlt'}),catalog('fr',{Only:'Other'},'other'),
    catalog('ar',{'%d item':{zero:'%d zero',one:'%d one',two:'%d two',few:'%d few',many:'%d many',other:'%d other'}}),
  ]});
  assert.equal(i18n.__('Hello'),'Salut');assert.equal(i18n.__('Missing'),'Fehlt');assert.equal(i18n.__('Only'),'Only');
  const ar = i18n.forLocale('ar');
  for (const n of [0,1,2,3,11,100]) assert.equal(ar._n('%d item','%d items',n),`%d ${new Intl.PluralRules('ar').select(n)}`);
  assert.equal(ar.isRTL(),true); assert.equal(i18n.isRTL(),false);
});

test('request locales are isolated across concurrent asynchronous handlers and dispose', async () => {
  const requests = createRequestI18n(createI18n({domain:'shop',catalogs:[catalog(),catalog('de',{Hello:'Hallo'})]}));
  assert.deepEqual(await Promise.all(['fr','de'].map(locale=>requests.run(locale,async()=>{await tick();return requests.current().__('Hello');}))),['Bonjour','Hallo']);
  assert.throws(()=>requests.current(), /no active/);requests.dispose();assert.throws(()=>requests.run('fr',()=>{}), /disposed/);
});

test('single-flight loading, per-waiter cancellation, source invalidation and close ownership', async () => {
  const pending = deferred(); let calls = 0, signal;
  const loader = createCatalogLoader({'fr/shop': async context=>{calls++;signal=context.signal;return pending.promise;}});
  const abort = new AbortController();
  const a = loader.load('fr/shop',{signal:abort.signal}); const b = loader.load('fr/shop');
  await tick(); abort.abort(); await assert.rejects(a,/cancelled/);assert.equal(signal.aborted,false);
  pending.resolve(catalog());assert.equal((await b).locale,'fr');assert.equal(calls,1);
  await loader.load('fr/shop');assert.equal(calls,1);
  loader.invalidate('fr/shop');await loader.load('fr/shop');assert.equal(calls,2);
  assert.equal(loader.getStatus().cached,1);await loader.close();assert.deepEqual(loader.getStatus(),{cached:0,bytes:0,pending:0,closed:true});
  await assert.rejects(loader.load('fr/shop'),/closed/);
});

test('invalidated pending loads cannot repopulate cache; noncooperative work retains its slot through cleanup', async () => {
  const pending=deferred(); const loader=createCatalogLoader({'fr/shop':()=>pending.promise},{maxInFlight:1});
  const result=loader.load('fr/shop');await tick();loader.clear();await assert.rejects(result,/cancelled/);
  assert.equal(loader.getStatus().pending,1);const close=loader.close();pending.resolve(catalog());await close;
  assert.equal(loader.getStatus().cached,0);assert.equal(loader.getStatus().pending,0);
});

test('loader failure retries, wrong catalogs reject, timeout aborts, and byte/in-flight limits hold', async () => {
  let attempts=0;
  const loader=createCatalogLoader({'fr/shop':async()=>{if(++attempts===1)throw new Error('backend unavailable');return catalog();}});
  await assert.rejects(loader.load('fr/shop'),/backend unavailable/);await loader.load('fr/shop');await loader.close();
  const wrong=createCatalogLoader({'fr/shop':async()=>catalog('de')});await assert.rejects(wrong.load('fr/shop'),/wrong locale/);await wrong.close();
  const tiny=createCatalogLoader({'fr/shop':async()=>catalog()},{maxBytes:1});await assert.rejects(tiny.load('fr/shop'),/byte limit/);await tiny.close();
  const slow=createCatalogLoader({'fr/shop':({signal})=>new Promise(resolve=>signal.addEventListener('abort',()=>resolve(catalog()),{once:true})), 'de/shop':async()=>catalog('de')},{timeoutMs:10,maxInFlight:1});
  const waiting=slow.load('fr/shop');await tick();await assert.rejects(slow.load('de/shop'),/in-flight/);await assert.rejects(waiting,/cancelled/);await slow.close();
  await assert.rejects(slow.load('../../private'),/undeclared/);
});

test('locale controller cancels obsolete loading and preserves locale on dependency failure', async () => {
  const i18n=createI18n({domain:'shop'});let aborted=false;
  const loader=createCatalogLoader({
    'fr/shop':({signal})=>new Promise(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve(catalog());},{once:true})),
    'de/shop':async()=>catalog('de',{Hello:'Hallo'}),
    'ar/shop':async()=>{throw new Error('dependency unavailable');},
  });
  const controller=createLocaleController(i18n,loader,{supportedLocales:['fr','de','ar'],domains:['shop']});
  const old=controller.switchLocale('fr');await tick();assert.equal(await controller.switchLocale('de'),true);assert.equal(await old,false);assert.equal(aborted,true);
  await assert.rejects(controller.switchLocale('ar'),/dependency unavailable/);assert.equal(i18n.getLocale(),'de');
  controller.dispose();await loader.close();
});

test('snapshots are inert and corrupt/oversized data fail; build gzip roundtrips deterministically', async () => {
  const c=catalog('fr',{Hello:'</script>\u2028<script>'});const text=serializeCatalogs([c]);assert.equal(text.includes('<'),false);
  assert.equal(parseCatalogs(text).catalogs[0].messages.Hello,c.messages.Hello);
  assert.throws(()=>parseCatalogs('{'),SyntaxError);assert.throws(()=>parseCatalogs('{"version":2,"catalogs":[]}'),/unsupported/);
  assert.throws(()=>parseCatalogs(text,{maxBytes:2}),/byte limit/);
  const compressed=await compressCatalogs([c]);assert.deepEqual(await compressCatalogs([c]),compressed);
  assert.equal(gunzipSync(compressed).toString(),text);
});

test('optional security encoding distinguishes inert text, attributes, JSON and URL policy', () => {
  assert.equal(escapeHtmlText('<script>'),'&lt;script&gt;');assert.equal(escapeHtmlAttribute('x\n"'),'x&#xa;&quot;');
  assert.equal(serializeJsonForScript({text:'</script>'}).includes('<'),false);
  assert.throws(()=>validateNavigationUrl('javascript:alert(1)'),/Invalid/);
});

 test('same-locale selection replacement keeps shared work alive; invalid signals acquire no resources', async () => {
  const wait=deferred();let calls=0;
  const loader=createCatalogLoader({'fr/shop':async()=>{calls++;return wait.promise;}});
  await assert.rejects(loader.load('fr/shop',{signal:'invalid'}), /invalid cancellation/);
  assert.equal(loader.getStatus().pending,0);
  const controller=createLocaleController(createI18n(),loader,{supportedLocales:['fr'],domains:['shop']});
  const first=controller.switchLocale('fr');await tick();const second=controller.switchLocale('fr');
  wait.resolve(catalog());assert.equal(await first,false);assert.equal(await second,true);assert.equal(calls,1);
  controller.dispose();await loader.close();
});

test('falsy producer rejections remain failures and cache LRU bounds hold', async () => {
  let calls=0;const loader=createCatalogLoader({
    'fr/shop':async()=>{calls++;return catalog();},'de/shop':async()=>catalog('de'),
    'ar/shop':async()=>{throw null;},
  },{maxEntries:1});
  await loader.load('fr/shop');await loader.load('de/shop');assert.equal(loader.getStatus().cached,1);
  await loader.load('fr/shop');assert.equal(calls,2);
  let rejected=false;try{await loader.load('ar/shop');}catch(e){rejected=true;assert.equal(e,null);}
  assert.equal(rejected,true);await loader.close();
});
