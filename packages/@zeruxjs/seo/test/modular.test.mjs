import test from 'node:test';
import assert from 'node:assert/strict';
import { robotsResponse, sitemapResponse, createRobotsTxt } from '../dist/index.js';
test('SEO HTTP response helpers and crawldelay validation',()=>{
 assert.match(robotsResponse().headers['content-type'],/text\/plain/);
 assert.match(sitemapResponse([{loc:'https://example.com'}]).body,/<urlset/);
 assert.throws(()=>createRobotsTxt({groups:[{userAgent:'*',crawlDelay:-1}]}),RangeError);
});
