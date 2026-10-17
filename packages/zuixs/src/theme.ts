import type { ZuixTheme, ZuixConfig } from './types.js';
const numeric = (start: number, end: number, step = 1) => Object.fromEntries(Array.from({length: Math.round((end-start)/step)+1},(_,i)=>{ const n=start+i*step; return [String(n), `${n*0.25}rem`]; }));
const palette: Record<string, string[]> = {
 slate:['#f8fafc','#f1f5f9','#e2e8f0','#cbd5e1','#94a3b8','#64748b','#475569','#334155','#1e293b','#0f172a','#020617'],
 gray:['#f9fafb','#f3f4f6','#e5e7eb','#d1d5db','#9ca3af','#6b7280','#4b5563','#374151','#1f2937','#111827','#030712'],
 red:['#fef2f2','#fee2e2','#fecaca','#fca5a5','#f87171','#ef4444','#dc2626','#b91c1c','#991b1b','#7f1d1d','#450a0a'],
 blue:['#eff6ff','#dbeafe','#bfdbfe','#93c5fd','#60a5fa','#3b82f6','#2563eb','#1d4ed8','#1e40af','#1e3a8a','#172554'],
 green:['#f0fdf4','#dcfce7','#bbf7d0','#86efac','#4ade80','#22c55e','#16a34a','#15803d','#166534','#14532d','#052e16'],
 yellow:['#fefce8','#fef9c3','#fef08a','#fde047','#facc15','#eab308','#ca8a04','#a16207','#854d0e','#713f12','#422006'],
 purple:['#faf5ff','#f3e8ff','#e9d5ff','#d8b4fe','#c084fc','#a855f7','#9333ea','#7e22ce','#6b21a8','#581c87','#3b0764'],
 pink:['#fdf2f8','#fce7f3','#fbcfe8','#f9a8d4','#f472b6','#ec4899','#db2777','#be185d','#9d174d','#831843','#500724'],
 orange:['#fff7ed','#ffedd5','#fed7aa','#fdba74','#fb923c','#f97316','#ea580c','#c2410c','#9a3412','#7c2d12','#431407'],
 indigo:['#eef2ff','#e0e7ff','#c7d2fe','#a5b4fc','#818cf8','#6366f1','#4f46e5','#4338ca','#3730a3','#312e81','#1e1b4b'],
 teal:['#f0fdfa','#ccfbf1','#99f6e4','#5eead4','#2dd4bf','#14b8a6','#0d9488','#0f766e','#115e59','#134e4a','#042f2e']
};
const colors: Record<string,string> = { transparent:'transparent', current:'currentColor', inherit:'inherit', black:'#000', white:'#fff' };
for (const [name,values] of Object.entries(palette)) values.forEach((value,i)=>colors[`${name}-${i===0?50:i===10?950:i*100}`]=value);
export const defaultTheme: ZuixTheme = {
 colors, spacing:{px:'1px','0':'0', ...numeric(0.5, 12,0.5), ...numeric(13, 24), ...numeric(28, 96,4), full:'100%'},
 fontSize:{xs:'.75rem',sm:'.875rem',base:'1rem',lg:'1.125rem',xl:'1.25rem','2xl':'1.5rem','3xl':'1.875rem','4xl':'2.25rem','5xl':'3rem','6xl':'3.75rem','7xl':'4.5rem','8xl':'6rem','9xl':'8rem'},
 fontWeight:{thin:100,extralight:200,light:300,normal:400,medium:500,semibold:600,bold:700,extrabold:800,black:900},
 radius:{none:'0',sm:'.125rem',DEFAULT:'.25rem',md:'.375rem',lg:'.5rem',xl:'.75rem','2xl':'1rem','3xl':'1.5rem',full:'9999px'},
 screens:{sm:'640px',md:'768px',lg:'1024px',xl:'1280px','2xl':'1536px'},
 shadows:{sm:'0 1px 2px #0000000d',DEFAULT:'0 1px 3px #0000001a,0 1px 2px #0000000f',md:'0 4px 6px -1px #0000001a',lg:'0 10px 15px -3px #0000001a',xl:'0 20px 25px -5px #0000001a',none:'none'},
 zIndex:{auto:'auto','0':'0','10':'10','20':'20','30':'30','40':'40','50':'50'}
};
export function resolveTheme(config: ZuixConfig = {}): ZuixTheme {
 const theme: ZuixTheme = {...defaultTheme};
 for (const key of Object.keys(defaultTheme)) theme[key]={...defaultTheme[key]};
 for (const source of [config.theme,config.extend]) for(const [key,value] of Object.entries(source??{})) if(value) theme[key]={...(key in theme ? theme[key] : {}),...value};
 return theme;
}
