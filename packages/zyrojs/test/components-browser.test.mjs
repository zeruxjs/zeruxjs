import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

// Explicit opt-in: do not download browsers, start applications or turn missing environments into success.
test('browser keyed fragment focus, nested updates and detached listener cleanup', {skip: process.env.ZX_TEST_BROWSER !== '1' ? 'requires ZX_TEST_BROWSER=1, installed Playwright and Chromium' : false}, async () => {
  const { chromium } = await import('playwright');
  const server = createServer(async (req, res) => {
    if (req.url === '/') {res.setHeader('content-type', 'text/html');res.end('<script type="importmap">{"imports":{"@zeruxjs/security/encoding":"/security/encoding.js"}}</script><div id="app"></div>');return;}
    if (req.url === '/security/encoding.js') {res.setHeader('content-type','text/javascript');res.end(await readFile(new URL('../../@zeruxjs/security/dist/encoding.js',import.meta.url)));return;}
    if (!/^\/dist\/(?:[a-z-]+\/)*[a-z-]+\.js$/.test(req.url ?? '')) {res.writeHead(404).end();return;}
    try {const data = await readFile(new URL(`..${req.url}`, import.meta.url));res.setHeader('content-type', 'text/javascript');res.end(data);}
    catch {res.writeHead(404).end();}
  });
  let browser;
  try {
    await new Promise((resolve, reject) => {server.once('error', reject);server.listen(0, '127.0.0.1', resolve);});
    browser = await chromium.launch({headless: true});
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result = await page.evaluate(async () => {
      const { h, render, unmount, defineComponent, signal, useState, onScopeDispose } = await import('/dist/index.js');
      const container = document.querySelector('#app'), tick = signal(0);
      let disposed = 0, clicks = 0;
      const Item = defineComponent(() => {
        const [count, setCount] = useState(0);
        onScopeDispose(() => disposed++);
        return props => [h('input', {'data-id': props.id}), h('button', {onClick: () => {clicks++;setCount(count() + 1);}}, `${props.id}:${count()}:${tick.value}`)];
      });
      const list = ids => h('section', {}, ...ids.map(id => h(Item, {key: id, id})));
      render(list([1,2,3]), container);
      const input = container.querySelector('[data-id="1"]'), removed = container.querySelectorAll('button')[1];
      input.value = 'edited';input.focus();input.setSelectionRange(1,4);
      render(list([3,1,4]), container);
      const retained = container.querySelector('[data-id="1"]') === input;
      const focused = document.activeElement === input && input.selectionStart === 1 && input.selectionEnd === 4;
      container.querySelectorAll('button')[1].click();tick.value++;
      const text = container.textContent;
      removed.click();
      unmount(container);
      input.dispatchEvent(new Event('input'));tick.value++;
      removed.click();
      return {retained, focused, text, clicks, disposed, empty: container.childNodes.length === 0};
    });
    assert.deepEqual(result, {retained: true, focused: true, text: '3:0:11:1:14:0:1', clicks: 1, disposed: 4, empty: true});
  } finally {
    try { await browser?.close(); }
    finally { await new Promise(resolve => {server.close(resolve);server.closeAllConnections();}); }
  }
});
