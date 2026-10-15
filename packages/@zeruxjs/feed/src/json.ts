import type { FeedOptions } from './types.js';
import { escapeXml, safeFeedUrl, date, validate, updated } from './utils.js';
export function createJsonFeed(options:FeedOptions):string {
 validate(options);return JSON.stringify({version:'https://jsonfeed.org/version/1.1',title:options.title,home_page_url:safeFeedUrl(options.siteUrl),feed_url:options.feedUrl?safeFeedUrl(options.feedUrl):undefined,description:options.description,language:options.language,icon:options.image?safeFeedUrl(options.image):undefined,items:options.items.map(i=>({id:i.id,url:safeFeedUrl(i.url),title:i.title,content_text:i.description,content_html:i.contentHtml,date_published:date(i.date),date_modified:date(i.updated),authors:i.author?[{name:i.author}]:undefined,tags:i.tags,image:i.image?safeFeedUrl(i.image):undefined,attachments:i.enclosure?[{url:safeFeedUrl(i.enclosure.url),mime_type:i.enclosure.type,size_in_bytes:i.enclosure.length}]:undefined}))},null,2);
}
