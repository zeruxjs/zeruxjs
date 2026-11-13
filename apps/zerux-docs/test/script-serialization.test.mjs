import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { document } from '../src/lib/template.mjs';
import { site, sitePath } from '../src/site.config.mjs';

/** Render synthetic metadata without evaluation. @param {string} description Inert metadata. @returns {string} HTML. */
function render(description) {
  const pages = site.versions.map((version) => ({
    slug: 'introduction',
    url: `/docs/${version.id}/introduction/`,
    title: 'Synthetic article',
    description,
    version: version.id,
    versionInfo: version,
    section: 'Get Started',
    sources: [],
    related: [],
  }));
  return document(pages[0], pages, '<p>Synthetic article body</p>');
}

for (const description of [
  'Public metadata',
  '</script><script>globalThis.probe=1</script>&>\u2028\u2029',
]) {
  test(`metadata remains inert: ${description === 'Public metadata' ? 'normal' : 'script termination'}`, () => {
    const dom = new JSDOM(render(description));
    try {
      const scripts = [...dom.window.document.querySelectorAll('script')];
      assert.equal(scripts.length, 4);
      assert.equal(scripts[0].type, 'application/ld+json');
      assert.equal(JSON.parse(scripts[0].textContent).description, description);
      assert.equal(scripts[0].textContent.includes('<'), false);
      assert.deepEqual(
        scripts.slice(1).map((script) => script.getAttribute('src')),
        ['docs', 'learning', 'offline'].map((name) =>
          sitePath(`/assets/${name}.js`)
        )
      );
      assert.ok(scripts.slice(1).every((script) => script.type === 'module'));
      assert.equal(dom.window.probe, undefined);
    } finally {
      dom.window.close();
    }
  });
}
