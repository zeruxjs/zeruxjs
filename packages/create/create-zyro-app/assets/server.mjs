import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { h, renderToString } from 'zyrojs/dom';
import { renderToHydratable } from 'zyrojs/server';
import {
  escapeHtmlText,
  escapeHtmlAttribute,
} from '@zeruxjs/security/encoding';
import { App, validatePublicProps } from './App.js';
import { serve } from '../scripts/http.mjs';
const directory = fileURLToPath(new URL('./', import.meta.url));
const manifest = JSON.parse(
  fs.readFileSync(new URL('build-manifest.json', import.meta.url), 'utf8'),
);
const config = manifest.config;
if (!['ssr', 'hydrated'].includes(config.mode))
  throw Error('Server build mode mismatch');
serve({
  directory,
  config,
  files: manifest.files
    .filter((f) => /\.(?:js|css)$/.test(f.file))
    .map((f) => f.file),
  render() {
    const props = validatePublicProps({
      title: config.title,
      interactive: config.mode === 'hydrated',
    });
    const rendered =
      config.mode === 'hydrated'
        ? renderToHydratable(App, props, {
            idPrefix: 'demo',
            validateProps: validatePublicProps,
          })
        : { html: renderToString(h(App, props)), data: '' };
    return (
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' +
      escapeHtmlText(config.title) +
      '</title><link rel="stylesheet" href="' +
      escapeHtmlAttribute(manifest.assets.style) +
      '"></head><body><div id="app">' +
      rendered.html +
      '</div>' +
      (config.mode === 'hydrated'
        ? '<script id="zyro-state" type="application/json">' +
          rendered.data +
          '</script><script defer src="' +
          escapeHtmlAttribute(manifest.assets.client) +
          '"></script>'
        : '') +
      '</body></html>'
    );
  },
});
