import test from 'node:test';
import assert from 'node:assert/strict';
import {createMetaTags,createSitemap,createSitemapIndex,createRobotsTxt,createJsonLd} from '../dist/index.js';
test('HTML/script injection is escaped',()=>{
  const html=createMetaTags({title:'<img src=x>',canonical:'https://example.com/',jsonLd:{value:'</script><script>alert(1)</script>'}});
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('</script><script>'));
  assert.ok(createJsonLd({value:'<'}).includes('\\u003c'));
});
test('sitemap alternates and validation',()=>{
 const xml=createSitemap([{loc:'https://example.com',images:['https://example.com/a.png'],alternates:{fr:'https://example.com/fr'}}]);
 assert.match(xml,/xmlns:image/);assert.match(xml,/xmlns:xhtml/);
 assert.match(createSitemapIndex([{loc:'https://example.com/sitemap.xml'}]),/sitemapindex/);
 assert.throws(()=>createSitemap([{loc:'javascript:evil'}]),/HTTP/);
 assert.throws(()=>createRobotsTxt({disallow:['/a\nb']}),/line breaks/);
});
