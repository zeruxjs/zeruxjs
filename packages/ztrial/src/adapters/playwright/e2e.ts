import type {PageLike} from './page.js';
export async function runE2E(page: PageLike, steps: readonly ((page:PageLike)=>Promise<unknown>)[]) { for(const step of steps)await step(page); }
