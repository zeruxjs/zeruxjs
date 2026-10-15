import type { ZuixTheme } from './types.js';
export type Declarations = Record<string,string>;
const staticRules: Record<string,Declarations> = {
 block:{display:'block'},inline:{display:'inline'},'inline-block':{display:'inline-block'},flex:{display:'flex'},'inline-flex':{display:'inline-flex'},grid:{display:'grid'},'inline-grid':{display:'inline-grid'},hidden:{display:'none'},contents:{display:'contents'},flow:{display:'flow-root'},
 relative:{position:'relative'},absolute:{position:'absolute'},fixed:{position:'fixed'},sticky:{position:'sticky'},static:{position:'static'},
 'flex-row':{'flex-direction':'row'},'flex-col':{'flex-direction':'column'},'flex-row-reverse':{'flex-direction':'row-reverse'},'flex-col-reverse':{'flex-direction':'column-reverse'},'flex-wrap':{'flex-wrap':'wrap'},'flex-nowrap':{'flex-wrap':'nowrap'},'flex-1':{flex:'1 1 0%'},'flex-auto':{flex:'1 1 auto'},'flex-none':{flex:'none'},'grow':{'flex-grow':'1'},'grow-0':{'flex-grow':'0'},'shrink':{'flex-shrink':'1'},'shrink-0':{'flex-shrink':'0'},
 'items-center':{'align-items':'center'},'items-start':{'align-items':'flex-start'},'items-end':{'align-items':'flex-end'},'items-stretch':{'align-items':'stretch'},'items-baseline':{'align-items':'baseline'},
 'justify-center':{'justify-content':'center'},'justify-between':{'justify-content':'space-between'},'justify-around':{'justify-content':'space-around'},'justify-evenly':{'justify-content':'space-evenly'},'justify-start':{'justify-content':'flex-start'},'justify-end':{'justify-content':'flex-end'},
 'self-center':{'align-self':'center'},'self-start':{'align-self':'flex-start'},'self-end':{'align-self':'flex-end'},'place-items-center':{'place-items':'center'},
 'overflow-hidden':{overflow:'hidden'},'overflow-auto':{overflow:'auto'},'overflow-scroll':{overflow:'scroll'},'overflow-visible':{overflow:'visible'},'overflow-x-auto':{'overflow-x':'auto'},'overflow-y-auto':{'overflow-y':'auto'},
 'cursor-pointer':{cursor:'pointer'},'cursor-default':{cursor:'default'},'cursor-not-allowed':{cursor:'not-allowed'},'pointer-events-none':{'pointer-events':'none'},'pointer-events-auto':{'pointer-events':'auto'},
 'select-none':{'user-select':'none'},'select-text':{'user-select':'text'},'sr-only':{position:'absolute',width:'1px',height:'1px',padding:'0',margin:'-1px',overflow:'hidden',clip:'rect(0,0,0,0)','white-space':'nowrap',border:'0'},
 'not-sr-only':{position:'static',width:'auto',height:'auto',padding:'0',margin:'0',overflow:'visible',clip:'auto','white-space':'normal'},
 'text-left':{'text-align':'left'},'text-center':{'text-align':'center'},'text-right':{'text-align':'right'},'text-justify':{'text-align':'justify'},
 'font-sans':{'font-family':'ui-sans-serif,system-ui,sans-serif'},'font-serif':{'font-family':'ui-serif,Georgia,serif'},'font-mono':{'font-family':'ui-monospace,monospace'},
 italic:{'font-style':'italic'},'not-italic':{'font-style':'normal'},uppercase:{'text-transform':'uppercase'},lowercase:{'text-transform':'lowercase'},capitalize:{'text-transform':'capitalize'},'normal-case':{'text-transform':'none'},underline:{'text-decoration-line':'underline'},'no-underline':{'text-decoration-line':'none'},'line-through':{'text-decoration-line':'line-through'},truncate:{overflow:'hidden','text-overflow':'ellipsis','white-space':'nowrap'},'whitespace-nowrap':{'white-space':'nowrap'},'whitespace-pre':{'white-space':'pre'},'break-all':{'word-break':'break-all'},'break-words':{'overflow-wrap':'break-word'},
 'rounded-none':{'border-radius':'0'},'border-solid':{'border-style':'solid'},'border-dashed':{'border-style':'dashed'},'border-none':{'border-style':'none'},
 'object-cover':{'object-fit':'cover'},'object-contain':{'object-fit':'contain'},'object-fill':{'object-fit':'fill'},'object-center':{'object-position':'center'},
 'w-full':{width:'100%'},'h-full':{height:'100%'},'w-screen':{width:'100vw'},'h-screen':{height:'100vh'},'min-h-screen':{'min-height':'100vh'},'max-w-full':{'max-width':'100%'},'w-auto':{width:'auto'},'h-auto':{height:'auto'},'w-fit':{width:'fit-content'},'h-fit':{height:'fit-content'},
 'aspect-square':{'aspect-ratio':'1 / 1'},'aspect-video':{'aspect-ratio':'16 / 9'},'appearance-none':{appearance:'none'},'antialiased':{'-webkit-font-smoothing':'antialiased'},'transition':{transition:'color,background-color,border-color,box-shadow,transform,opacity 150ms ease'},'transition-all':{transition:'all 150ms ease'},'transition-none':{transition:'none'},'transform':{transform:'translateZ(0)'},
 'animate-spin':{animation:'zuix-spin 1s linear infinite'},'animate-pulse':{animation:'zuix-pulse 2s cubic-bezier(.4,0,.6,1) infinite'},
 'container-normal':{'container-type':'normal'},'container-size':{'container-type':'size'},'container-inline':{'container-type':'inline-size'},
 'isolate':{isolation:'isolate'},'isolation-auto':{isolation:'auto'},'invisible':{visibility:'hidden'},'visible':{visibility:'visible'},
 'content-auto':{'content-visibility':'auto'},'content-hidden':{'content-visibility':'hidden'},'content-visible':{'content-visibility':'visible'},
 'overscroll-none':{'overscroll-behavior':'none'},'overscroll-contain':{'overscroll-behavior':'contain'},'overscroll-auto':{'overscroll-behavior':'auto'},
 'scroll-smooth':{'scroll-behavior':'smooth'},'scroll-auto':{'scroll-behavior':'auto'},'snap-x':{'scroll-snap-type':'x mandatory'},'snap-y':{'scroll-snap-type':'y mandatory'},'snap-both':{'scroll-snap-type':'both mandatory'},'snap-none':{'scroll-snap-type':'none'},'snap-start':{'scroll-snap-align':'start'},'snap-center':{'scroll-snap-align':'center'},'snap-end':{'scroll-snap-align':'end'},
 'touch-none':{'touch-action':'none'},'touch-auto':{'touch-action':'auto'},'touch-pan-x':{'touch-action':'pan-x'},'touch-pan-y':{'touch-action':'pan-y'},'touch-manipulation':{'touch-action':'manipulation'},
 'text-balance':{'text-wrap':'balance'},'text-pretty':{'text-wrap':'pretty'},'text-nowrap':{'text-wrap':'nowrap'},'text-wrap':{'text-wrap':'wrap'},
 'break-normal':{'overflow-wrap':'normal','word-break':'normal'},'hyphens-auto':{hyphens:'auto'},'hyphens-none':{hyphens:'none'},
 'writing-vertical-rl':{'writing-mode':'vertical-rl'},'writing-vertical-lr':{'writing-mode':'vertical-lr'},'writing-horizontal':{'writing-mode':'horizontal-tb'},
 'subgrid-cols':{'grid-template-columns':'subgrid'},'subgrid-rows':{'grid-template-rows':'subgrid'},
 'animate-none':{animation:'none'},'animate-bounce':{animation:'zuix-bounce 1s infinite'},'animate-ping':{animation:'zuix-ping 1s cubic-bezier(0,0,.2,1) infinite'},
 'transition-discrete':{'transition-behavior':'allow-discrete'},'backface-hidden':{'backface-visibility':'hidden'},'backface-visible':{'backface-visibility':'visible'},
 'view-transition-none':{'view-transition-name':'none'},'field-sizing-content':{'field-sizing':'content'},'field-sizing-fixed':{'field-sizing':'fixed'},
 'will-change-auto':{'will-change':'auto'},'will-change-transform':{'will-change':'transform'},'will-change-scroll':{'will-change':'scroll-position'},
 'color-scheme-light':{'color-scheme':'light'},'color-scheme-dark':{'color-scheme':'dark'},'color-scheme-normal':{'color-scheme':'normal'},
 'forced-color-adjust-none':{'forced-color-adjust':'none'},'forced-color-adjust-auto':{'forced-color-adjust':'auto'},
 'bg-fixed':{'background-attachment':'fixed'},'bg-scroll':{'background-attachment':'scroll'},'bg-local':{'background-attachment':'local'},
 'bg-cover':{'background-size':'cover'},'bg-contain':{'background-size':'contain'},'bg-center':{'background-position':'center'},'bg-no-repeat':{'background-repeat':'no-repeat'},
 'mix-blend-multiply':{'mix-blend-mode':'multiply'},'mix-blend-screen':{'mix-blend-mode':'screen'},'mix-blend-overlay':{'mix-blend-mode':'overlay'},
 'backdrop-blur-none':{'backdrop-filter':'none'},'blur-none':{filter:'none'},
 'table':{display:'table'},'table-row':{display:'table-row'},'table-cell':{display:'table-cell'},
  'border-collapse':{'border-collapse':'collapse'},'border-separate':{'border-collapse':'separate'},'list-none':{'list-style-type':'none'},'list-disc':{'list-style-type':'disc'},'list-decimal':{'list-style-type':'decimal'},
};
const negativeAllowed = new Set(['m','mx','my','mt','mr','mb','ml','ms','me','top','right','bottom','left','inset','inset-x','inset-y','translate-x','translate-y']);
function arbitrary(value:string):string|undefined { if(!/^\[[^;{}]+\]$/.test(value)) return; return value.slice(1,-1).replace(/_/g,' '); }
function scale(theme:ZuixTheme,group:keyof ZuixTheme,value:string) { return arbitrary(value)??(theme[group][value]===undefined?undefined:String(theme[group][value])); }
function spacingProps(prefix:string):string[]|undefined { const props:Record<string,string[]>={p:['padding'],px:['padding-left','padding-right'],py:['padding-top','padding-bottom'],pt:['padding-top'],pr:['padding-right'],pb:['padding-bottom'],pl:['padding-left'],ps:['padding-inline-start'],pe:['padding-inline-end'],m:['margin'],mx:['margin-left','margin-right'],my:['margin-top','margin-bottom'],mt:['margin-top'],mr:['margin-right'],mb:['margin-bottom'],ml:['margin-left'],ms:['margin-inline-start'],me:['margin-inline-end'],gap:['gap'],'gap-x':['column-gap'],'gap-y':['row-gap'],space:[],top:['top'],right:['right'],bottom:['bottom'],left:['left'],inset:['inset'],'inset-x':['left','right'],'inset-y':['top','bottom']};return props[prefix]; }
function declarations(properties:string[],value:string):Declarations {return Object.fromEntries(properties.map(p=>[p,value]));}
export function utilityFor(input:string,theme:ZuixTheme,additional:Record<string,Declarations>={}):Declarations|undefined {
 if(additional[input])return additional[input];if(staticRules[input])return staticRules[input];
 const negative=input.startsWith('-'); const name=negative?input.slice(1):input;
 const spacing=/^(inset-x|inset-y|gap-x|gap-y|[pm][xytrblse]?|gap|top|right|bottom|left|inset)-(.+)$/.exec(name);
 if(spacing){const props=spacingProps(spacing[1]);const value=scale(theme,'spacing',spacing[2])??(spacing[2]==='auto'?'auto':spacing[2]==='full'?'100%':undefined);if(props?.length&&value&&(!negative||negativeAllowed.has(spacing[1])))return declarations(props,negative?`calc(${value} * -1)`:value);}
 const dimensions=/^(w|h|min-w|min-h|max-w|max-h|basis)-(.+)$/.exec(name);
 if(dimensions){const prop=({w:'width',h:'height','min-w':'min-width','min-h':'min-height','max-w':'max-width','max-h':'max-height',basis:'flex-basis'} as Record<string,string>)[dimensions[1]];const v=scale(theme,'spacing',dimensions[2])??({full:'100%',auto:'auto',screen:dimensions[1].endsWith('w')?'100vw':'100vh',min:'min-content',max:'max-content',fit:'fit-content',none:'none'} as Record<string,string>)[dimensions[2]];if(v)return {[prop]:v};}
 const color=/^(bg|text|border|ring|fill|stroke|decoration|placeholder)-(.+)$/.exec(name);
 if(color){const group=color[1], key=color[2];const [colorKey,opacity]=key.split('/');const v=scale(theme,'colors',colorKey);if(v){const property=({bg:'background-color',text:'color',border:'border-color',ring:'--zuix-ring-color',fill:'fill',stroke:'stroke',decoration:'text-decoration-color',placeholder:'--zuix-placeholder-color'} as Record<string,string>)[group];const colorValue=opacity&&/^\d+$/.test(opacity)?`color-mix(in srgb, ${v} ${Math.min(100,Number(opacity))}%, transparent)`:v;return {[property]:colorValue};}}
 const font=/^font-(.+)$/.exec(name);if(font){const v=scale(theme,'fontWeight',font[1]);if(v)return {'font-weight':v};}
 const text=/^text-(.+)$/.exec(name);if(text){const v=scale(theme,'fontSize',text[1]);if(v)return {'font-size':v};}
 const rounded=/^rounded(?:-(.+))?$/.exec(name);if(rounded){const v=scale(theme,'radius',rounded[1]??'DEFAULT');if(v)return {'border-radius':v};}
 const shadow=/^shadow(?:-(.+))?$/.exec(name);if(shadow){const v=scale(theme,'shadows',shadow[1]??'DEFAULT');if(v)return {'box-shadow':v};}
 const z=/^z-(.+)$/.exec(name);if(z){const v=scale(theme,'zIndex',z[1]);if(v)return {'z-index':v};}
 const opacity=/^opacity-(\d+)$/.exec(name);if(opacity&&Number(opacity[1])<=100)return {opacity:String(Number(opacity[1])/100)};
 const columns=/^grid-cols-(\d+)$/.exec(name);if(columns&&Number(columns[1])<=24&&Number(columns[1])>0)return {'grid-template-columns':`repeat(${columns[1]},minmax(0,1fr))`};
 const rows=/^grid-rows-(\d+)$/.exec(name);if(rows&&Number(rows[1])<=24&&Number(rows[1])>0)return {'grid-template-rows':`repeat(${rows[1]},minmax(0,1fr))`};
 const span=/^col-span-(\d+|full)$/.exec(name);if(span)return {'grid-column':span[1]==='full'?'1 / -1':`span ${span[1]} / span ${span[1]}`};
 const border=/^border(?:-(\d+))?$/.exec(name);if(border)return {'border-width':`${border[1]??1}px`};
 const line=/^leading-(.+)$/.exec(name);if(line){const vals:Record<string,string>={none:'1',tight:'1.25',snug:'1.375',normal:'1.5',relaxed:'1.625',loose:'2'};const v=arbitrary(line[1])??vals[line[1]];if(v)return {'line-height':v};}
 const tracking=/^tracking-(.+)$/.exec(name);if(tracking){const vals:Record<string,string>={tighter:'-.05em',tight:'-.025em',normal:'0',wide:'.025em',wider:'.05em',widest:'.1em'};const v=arbitrary(tracking[1])??vals[tracking[1]];if(v)return {'letter-spacing':v};}
 const duration=/^duration-(\d+)$/.exec(name);if(duration)return {'transition-duration':`${duration[1]}ms`};
 const rotate=/^rotate-(\d+)$/.exec(name);if(rotate)return {transform:`rotate(${negative?'-':''}${rotate[1]}deg)`};
 const transform=/^(translate-[xy]|scale)-(.*)$/.exec(name);if(transform){const v=transform[1]==='scale'?String(Number(transform[2])/100):scale(theme,'spacing',transform[2]);if(v)return {transform:transform[1]==='scale'?`scale(${v})`:`translate${transform[1].endsWith('x')?'X':'Y'}(${negative?'-':''}${v})`};}
 const arbitraryGeneric=/^(container-name|container|anchor-name|position-anchor|position-area|view-transition-name|scroll-timeline|scroll-timeline-name|scroll-timeline-axis|view-timeline|view-timeline-name|view-timeline-axis|animation-timeline|animation-range|animation-range-start|animation-range-end|animation-duration|animation-delay|animation-direction|animation-fill-mode|animation-iteration-count|animation-play-state|animation-timing-function|transition-behavior|transition-property|transition-duration|transition-delay|transition-timing-function|filter|backdrop-filter|clip-path|mask|mask-image|mask-size|mask-position|mask-repeat|color-scheme|accent-color|caret-color|outline-color|outline-offset|outline-width|outline-style|grid-template-columns|grid-template-rows|grid-area|grid-column|grid-row|object-position|object-fit|aspect-ratio|columns|column-count|column-width|scroll-padding|scroll-margin|text-wrap|text-decoration|text-underline-offset|font-variation-settings|font-feature-settings|font-optical-sizing|font-palette|shape-outside|shape-margin|offset-path|offset-distance|offset-rotate|perspective|perspective-origin|transform-origin|transform-style|rotate|scale|translate)-(.+)$/.exec(name);
 if(arbitraryGeneric){const value=arbitrary(arbitraryGeneric[2]);if(value)return {[arbitraryGeneric[1]]:value};}
 const values=/^(ease|delay|duration|repeat|animate-delay|animate-duration|outline-offset|outline|blur|backdrop-blur)-(.+)$/.exec(name);
 if(values){const [,kind,key]=values;const val=arbitrary(key)??(/^(?:\d+(?:\.\d+)?)$/.test(key)?key:undefined);
 if(val){if(kind==='ease')return {'transition-timing-function':val};if(kind==='delay')return {'transition-delay':`${val}ms`};if(kind==='duration')return {'transition-duration':`${val}ms`};if(kind==='repeat')return {'animation-iteration-count':val};if(kind==='animate-delay')return {'animation-delay':`${val}ms`};if(kind==='animate-duration')return {'animation-duration':`${val}ms`};if(kind==='outline-offset')return {'outline-offset':`${val}px`};if(kind==='outline')return {'outline-width':`${val}px`};if(kind==='blur'||kind==='backdrop-blur')return {[kind==='blur'?'filter':'backdrop-filter']:`blur(${/^[0-9.]+$/.test(val)?val+'px':val})`};}}
 const gridGap=/^(col-start|col-end|row-start|row-end)-(\d+|auto)$/.exec(name);
 if(gridGap)return {[`grid-${gridGap[1].replace('-','-')}`]:gridGap[2]};
 const flexOrder=/^(order|grow|shrink)-(\d+)$/.exec(name);if(flexOrder)return {[flexOrder[1]==='order'?'order':`flex-${flexOrder[1]}`]:flexOrder[2]};
 const anim=/^animate-\[(.+)\]$/.exec(name);if(anim){const value=arbitrary('['+anim[1]+']');if(value)return {animation:value};}
  const arbitraryProperty=/^\[([a-zA-Z-]+):([^;{}]+)\]$/.exec(name);if(arbitraryProperty&&!/^(behavior|-moz-binding)$/i.test(arbitraryProperty[1]))return {[arbitraryProperty[1]]:arbitraryProperty[2].replace(/_/g,' ')};
 return undefined;
}
