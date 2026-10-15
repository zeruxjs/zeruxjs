import type { RobotsGroup } from './types.js';
import { safeUrl } from './escape.js';
function positiveDelay(delay:number):number { if (!Number.isFinite(delay) || delay < 0) throw new RangeError('Invalid crawl delay'); return delay; }
export function createRobotsTxt({allow=['/'],disallow=[],sitemap,groups}:{allow?:string[];disallow?:string[];sitemap?:string|string[];groups?:RobotsGroup[]}={}):string {
  const validate=(s:string)=>{if(/[\r\n\0]/.test(s))throw new TypeError('Robots directives cannot contain line breaks');return s;};
  const all=groups??[{userAgent:'*',allow,disallow}];
  const lines=all.flatMap(group=>[...([group.userAgent].flat().map(agent=>`User-agent: ${validate(agent)}`)),...(group.allow??[]).map(path=>`Allow: ${validate(path)}`),...(group.disallow??[]).map(path=>`Disallow: ${validate(path)}`),...(group.crawlDelay===undefined?[]:[`Crawl-delay: ${positiveDelay(group.crawlDelay)}`]),'']);
  for(const item of [sitemap??[]].flat()) lines.push(`Sitemap: ${safeUrl(item)}`);
  return lines.join('\n').trimEnd()+'\n';
}
