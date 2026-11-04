import test from 'node:test';
import assert from 'node:assert/strict';
import * as cssTree from 'css-tree';
import { createZuix, utilityFor, resolveTheme, extractClasses, compileStylesheet } from 'zuixs';

const expected = {
 'box-border':{'box-sizing':'border-box'},
 'grid-flow-col-dense':{'grid-auto-flow':'column dense'},
 'w-1/2':{width:'calc(1 / 2 * 100%)'},
 'h-2/3':{height:'calc(2 / 3 * 100%)'},
 'basis-1/4':{'flex-basis':'calc(1 / 4 * 100%)'},
 'size-4':{width:'1rem',height:'1rem'},
 'size-[3rem]':{width:'3rem',height:'3rem'},
 'col-start-2':{'grid-column-start':'2'},
 'row-end-auto':{'grid-row-end':'auto'},
 'text-start':{'text-align':'start'},
 'wrap-anywhere':{'overflow-wrap':'anywhere'},
 'whitespace-break-spaces':{'white-space':'break-spaces'},
 'leading-6':{'line-height':'1.5rem'},
 'decoration-wavy':{'text-decoration-style':'wavy'},
 'decoration-2':{'text-decoration-thickness':'2px'},
 'underline-offset-4':{'text-underline-offset':'4px'},
 'accent-blue-600':{'accent-color':'#2563eb'},
 'caret-[var(--caret)]':{'caret-color':'var(--caret)'},
 'resize-y':{resize:'vertical'},
 'appearance-auto':{appearance:'auto'},
 'container-inline-size':{'container-type':'inline-size'},
 'container-name-[card]':{'container-name':'card'},
 '[--step2:2rem]':{'--step2':'2rem'},
 'bg-[rgb(0_0_0/0.5)]':{'background-color':'rgb(0 0 0/0.5)'},
};

test('named families have exact declaration snapshots and independent CSS grammar checks',()=>{
 const theme=resolveTheme();
 for(const [token,declarations] of Object.entries(expected)){
  assert.deepEqual(utilityFor(token,theme),declarations,token);
  for(const [property,value] of Object.entries(declarations)){
   if(property.startsWith('--')||value.includes('var('))continue;
   assert.equal(cssTree.lexer.matchProperty(property,value).error,null,`${property}:${value}`);
  }
 }
 const tokens=Object.keys(expected),result=createZuix({preflight:false}).generate(tokens);
 assert.deepEqual(result.unmatched,[]);
 const parsed=cssTree.parse(result.css);assert.equal(parsed.children.size,tokens.length);
 const syntaxErrors=[];cssTree.parse(result.css,{onParseError:error=>syntaxErrors.push(error)});assert.deepEqual(syntaxErrors,[]);
 assert.equal(result.css,createZuix({preflight:false}).generate(tokens.reverse()).css);
});

test('variants compose named containers, prefix/important, RTL, form state, dark and reduced motion deterministically',()=>{
 const tokens=['cq-card-lg:hover:ui-w-1/2','cq-card-md:ui-w-full','dark:focus-visible:ui-!accent-blue-600','motion-reduce:ui-transition-none','rtl:ui-text-start','disabled:ui-caret-auto'];
 const compiler=createZuix({preflight:false,prefix:'ui-'}),result=compiler.generate(tokens);
 assert.deepEqual(result.unmatched,[]);assert.equal(result.css,compiler.generate(tokens.reverse()).css);
 assert.ok(result.css.indexOf('@container card (min-width: 768px)')<result.css.indexOf('@container card (min-width: 1024px)'));
 assert.match(result.css,/accent-color:#2563eb !important/);assert.match(result.css,/prefers-reduced-motion: reduce/);
 assert.match(result.css,/:where\(\[dir="rtl"\]\)/);assert.match(result.css,/:disabled/);
 assert.doesNotThrow(()=>cssTree.parse(result.css));
 assert.equal(compiler.compileClass('cq-none-md:ui-block'),undefined);
});

test('arbitrary syntax cannot escape declarations, conditions or selectors, including inherited pseudo names',()=>{
 const tokens=['constructor:p-4','__proto__:p-4','toString:p-4','w-[calc(2rem]','w-[1px]]','has-[.x)]:block','has-[:is(.x]:block','media-[width:1px)]:block',
  'container-[(min-width:1px]:block','supports-[display:grid)]:block','[color:red;display:block]','[color:red}body{color:blue]','[color:red/**/]','[background:URL(https://bad.example)]','[--x:var(--x)]broken','bg-red-500/not-opacity','scale-nope',
  `w-[${'calc('.repeat(9)}1px${')'.repeat(9)}]`,'hover:'.repeat(12)+'p-4'];
 const result=createZuix({preflight:false}).generate(tokens);
 assert.equal(result.css,'');assert.deepEqual(new Set(result.unmatched),new Set(tokens));
 const direct=resolveTheme({extend:{colors:{bad:'red;}body{display:none'}}});assert.equal(utilityFor('bg-bad',direct),undefined);
 assert.equal(utilityFor('[--x:1px;display:none]',direct),undefined);
 assert.deepEqual(utilityFor('block',direct),{display:'block'});
 const declaration=utilityFor('block',direct);declaration.display='none';assert.deepEqual(utilityFor('block',direct),{display:'block'});
});

test('scanner handles nested helpers and literal parentheses with bounded source/token/work',()=>{
 const source=`const x=cn('w-[calc(100%_-_2rem)]', ok && clsx('text-start', ['resize-y']), { 'accent-blue-600': ok }, \`size-\${n}\`);`;
 assert.deepEqual(extractClasses(source),['w-[calc(100%_-_2rem)]','text-start','resize-y','accent-blue-600']);
 assert.deepEqual(createZuix({preflight:false}).generate(extractClasses(source)).unmatched,[]);
 assert.throws(()=>extractClasses('x'.repeat(11),{limits:{maxFileBytes:10}}),/maxFileBytes/);
 assert.throws(()=>extractClasses('<p class="p-2 m-2">',{limits:{maxClasses:1}}),/maxClasses/);
 assert.throws(()=>extractClasses('<p class="long-token">',{limits:{maxTokenLength:4}}),/maxTokenLength/);
 assert.throws(()=>extractClasses('cn('+ '('.repeat(33)+'"block"'+')'.repeat(34)),/nesting/);
 assert.throws(()=>createZuix({limits:{maxClasses:1}}).generate(Array(17).fill('block')),/iteration/);
 assert.throws(()=>createZuix({limits:{maxTokenLength:3}}).generate(['block']),/maxTokenLength/);
 assert.deepEqual(extractClasses('cn(/* comment ) */ "block", nested("flex"))'),['block','flex']);
});

test('recipe/plugin priority and authored override order stay explicit and unsupported dependencies fail visibly',()=>{
 const config={preflight:false,plugins:[api=>api.addUtilities({'.text-start':{'text-align':'center'}})],recipes:[{selector:'.card',apply:['text-start','p-2']}]};
 const result=compileStylesheet('@import "zuixs"; .card{padding:3rem}', ['p-4','text-start'], config);
 assert.ok(result.css.indexOf('.card{text-align:center;padding:0.5rem;}')<result.css.indexOf('.p-4{padding:1rem;}'));
 assert.ok(result.css.indexOf('.p-4{padding:1rem;}')<result.css.lastIndexOf('.card{padding:3rem}'));
 assert.match(result.css,/\.text-start\{text-align:center;/);
 assert.throws(()=>createZuix({plugins:[()=>{throw new Error('plugin dependency unavailable');}]}),/dependency unavailable/);
 assert.throws(()=>createZuix({recipes:[{selector:'.card',apply:['unknown-family'] }]}).generate([]),/unsupported recipe utility/);
 assert.deepEqual(createZuix({preflight:false}).generate(['unknown-family']).unmatched,['unknown-family']);
});
