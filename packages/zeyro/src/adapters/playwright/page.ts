/** Explicit adapter: accepts existing Playwright page, no runtime dependency. */
export interface PageLike { goto(url:string, options?:object):Promise<unknown>; locator(selector:string): {count():Promise<number>;click(options?:object):Promise<unknown>}; }
export async function visit(page:PageLike,url:string) { if(!/^https?:\/\//.test(url)) throw new TypeError('Expected http(s) URL'); await page.goto(url); }
export async function click(page:PageLike,selector:string) { const loc=page.locator(selector); if(!await loc.count())throw new Error(`Element not found: ${selector}`);await loc.click(); }
