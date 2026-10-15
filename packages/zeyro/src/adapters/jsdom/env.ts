/** DOM environment is optional; no DOM emulator is installed implicitly. */
export function requireDom(): Document { if(typeof document === 'undefined') throw new Error('DOM is unavailable: install jsdom or run in a browser');return document; }
export async function createJsdomEnvironment(html = '<!doctype html><html><body></body></html>') {
  const specifier = 'jsdom';
  const mod = await import(specifier) as {JSDOM:new (html:string, options?:object)=>{window:Window & {close():void}}};
  const dom=new mod.JSDOM(html,{url:'http://localhost/'});
  return {window:dom.window, document:dom.window.document, cleanup:()=>dom.window.close()};
}
