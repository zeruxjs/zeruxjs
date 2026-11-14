import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
  mkdir,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { buildFontAssets, createFontToolsTool } from '../dist/build.js';
import { defineFont, svgIconMarkup, fontIcon } from '../dist/index.js';
/** Explicit synthetic header-fixture permission/provenance, not permission to redistribute a real font. */
const license = {
  id: 'LicenseRef-Fixture',
  source: 'local:authored-fixture',
  attribution: 'Synthetic test bytes, not a redistributable font',
  redistributionAllowed: true,
  subsettingAllowed: true,
};
// Only a container-header fixture: these tests qualify copying/budgets, not browser font decoding.
/** Create only a container-header fixture, not a decodable licensed font.
 * @returns {Buffer} Fixed bounded bytes used for copying/signature/budget checks. */
const fontBytes = () => {
  /** Synthetic header/asset bytes; these fixtures do not certify browser font decoding. */
  const bytes = Buffer.alloc(64);
  bytes.write('wOF2');
  bytes.writeUInt32BE(64, 8);
  return bytes;
};
/** Explicit synthetic local face with approved fixture provenance and preload selection. */
const font = {
  key: 'regular',
  family: 'Fixture',
  format: 'woff2',
  source: { path: 'fixture.woff2' },
  license,
  preload: true,
};
/** Own a synthetic project/font header and remove the temporary tree after build assertions.
 * @param {Function} fn - Borrowed async assertions over owned root and explicit build configuration.
 * @returns {Promise<void>} Synthetic test completion with cleanup; no real font/provider qualification.
 */
async function fixture(fn) {
  /** Owned temporary project root; fixture finally removes only this synthetic tree. */
  const root = await mkdtemp(join(tmpdir(), 'zx-font-'));
  try {
    await writeFile(join(root, 'fixture.woff2'), fontBytes());
    /** Explicit local output and non-root public mount for this synthetic build. */
    const config = {
      projectRoot: root,
      outputDir: 'public/fonts',
      publicBase: '/app/fonts/',
      fonts: [font],
    };
    await fn(root, config);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test('local hashed assets, license manifest, offline CSS and repeated output are deterministic', () =>
  fixture(async (root, config) => {
    /** First deterministic manifest used for repeat-output/hash assertions. */
    const first = await buildFontAssets(config);
    /** Repeated build manifest expected to match exactly without synthetic timestamps. */
    const second = await buildFontAssets(config);
    assert.deepEqual(first, second);
    assert.equal(first.preloads.length, 1);
    assert.equal(first.fonts[0].license.id, license.id);
    assert.equal(first.fonts[0].url, '/app/fonts/' + first.fonts[0].file);
    /** Synthetic header/asset bytes; these fixtures do not certify browser font decoding. */
    const bytes = await readFile(
      join(root, 'public/fonts', first.fonts[0].file)
    );
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      first.fonts[0].sha256
    );
    /** Emitted fixture CSS checked for local mounted URLs and absence of remote references. */
    const css = await readFile(
      join(root, 'public/fonts', first.css.file),
      'utf8'
    );
    assert.ok(css.includes(first.fonts[0].url));
    assert.doesNotMatch(css, /https?:/);
    assert.doesNotMatch(JSON.stringify(first), new RegExp(root));
    /** Copied synthetic input with one changed byte to verify content-hash invalidation. */
    const changed = fontBytes();
    changed[63] = 1;
    await writeFile(join(root, 'fixture.woff2'), changed);
    /** Manifest emitted after the intentional source-byte change. */
    const next = await buildFontAssets(config);
    assert.notEqual(next.fonts[0].url, first.fonts[0].url);
    assert.notEqual(next.digest, first.digest);
    assert.equal(
      (await readdir(root)).some((name) => name.startsWith('.font-')),
      false
    );
  }));
test('duplicate keys/equivalent families, invalid CSS/axes, rights and preload budgets reject', () =>
  fixture(async (root, config) => {
    // Each invalid candidate must reject before promotion without mutating previous good output.
    for (const fonts of [
      [
        font,
        {
          ...font,
          key: 'second',
          family: 'fixture',
          weight: 'normal',
          stretch: '100%',
        },
      ],
      [font, { ...font }],
      [{ ...font, display: 'swap; color:red' }],
      [{ ...font, style: 'normal; background:url(x)' }],
      [{ ...font, weight: '1001' }],
      [{ ...font, unicodeRange: 'U+FFFFFF' }],
      [{ ...font, variationSettings: '"wght" 300, "wght" 400' }],
      [
        {
          ...font,
          axes: [
            { tag: 'wght', min: 100, default: 400, max: 900 },
            { tag: 'wght', min: 100, default: 400, max: 900 },
          ],
        },
      ],
      [{ ...font, license: { ...license, redistributionAllowed: false } }],
    ]) {
      await assert.rejects(buildFontAssets({ ...config, fonts }));
    }
    await assert.rejects(
      buildFontAssets({ ...config, preload: { maxCount: 0, maxBytes: 1000 } }),
      /preload budget/
    );
    assert.equal(
      (await readdir(join(root, 'public'))).some((name) =>
        name.startsWith('.font-')
      ),
      false
    );
    assert.throws(() =>
      defineFont({
        family: 'A',
        sources: [{ url: '/a.woff2' }],
        featureSettings: '"liga" 1, "liga" 0',
      })
    );
  }));
test('remote failure, bounded redirects and deadline cancel readers while preserving previous output', () =>
  fixture(async (root, config) => {
    await buildFontAssets(config);
    /** Previous successful manifest bytes which failed candidates must preserve. */
    const previous = await readFile(
      join(root, 'public/fonts/manifest.json'),
      'utf8'
    );
    let cancelled = 0,
      calls = 0;
    /** Injected build-only transport; no live provider or host credentials are used. */
    const remote = {
      fetch: async () => {
        calls++;
        return new Response(
          new ReadableStream({
            cancel() {
              cancelled++;
            },
          }),
          { status: 302, headers: { location: 'https://unapproved.test/font' } }
        );
      },
      allowedOrigins: ['https://approved.test'],
    };
    /** Explicit synthetic face list, including invalid/remote/subset cases under test. */
    const fonts = [
      {
        ...font,
        source: { url: 'https://approved.test/font?private-token=SECRET' },
      },
    ];
    await assert.rejects(
      buildFontAssets({ ...config, fonts, remote }),
      (error) => !error.message.includes('SECRET')
    );
    assert.equal(calls, 1);
    assert.equal(cancelled, 1);
    await assert.rejects(
      buildFontAssets({
        ...config,
        fonts,
        remote: {
          ...remote,
          fetch: async () => {
            throw new Error('SECRET backend error');
          },
        },
      }),
      (error) => error.message === 'Build-time font acquisition failed'
    );
    /** Injected nonsettling body whose cooperative cancellation is observed after deadline. */
    const slow = {
      ...remote,
      timeoutMs: 10,
      fetch: async () =>
        new Response(
          new ReadableStream({
            pull() {
              return new Promise(() => {});
            },
            cancel() {
              cancelled++;
            },
          })
        ),
    };
    await assert.rejects(buildFontAssets({ ...config, fonts, remote: slow }));
    assert.equal(cancelled, 2);
    assert.equal(
      await readFile(join(root, 'public/fonts/manifest.json'), 'utf8'),
      previous
    );
    /** Synthetic header/asset bytes; these fixtures do not certify browser font decoding. */
    const bytes = fontBytes();
    /** Manifest after an injected successful remote-body acquisition, not a live provider result. */
    const success = await buildFontAssets({
      ...config,
      fonts,
      remote: {
        ...remote,
        fetch: async () =>
          new Response(bytes, {
            headers: { 'content-length': String(bytes.length) },
          }),
      },
    });
    assert.equal(
      success.fonts[0].sourceSha256,
      createHash('sha256').update(bytes).digest('hex')
    );
    assert.doesNotMatch(JSON.stringify(success), /SECRET|private-token/);
  }));
test('source/output traversal and symlinks fail; output quota failure retains last good assets', () =>
  fixture(async (root, config) => {
    await buildFontAssets(config);
    /** Previous successful manifest bytes which failed candidates must preserve. */
    const previous = await readFile(
      join(root, 'public/fonts/manifest.json'),
      'utf8'
    );
    await assert.rejects(
      buildFontAssets({ ...config, outputDir: '../escape' })
    );
    await assert.rejects(
      buildFontAssets({
        ...config,
        fonts: [{ ...font, source: { path: '../escape.woff2' } }],
      })
    );
    await symlink(join(root, 'fixture.woff2'), join(root, 'alias.woff2'));
    await assert.rejects(
      buildFontAssets({
        ...config,
        fonts: [{ ...font, source: { path: 'alias.woff2' } }],
      })
    );
    await mkdir(join(root, 'other'));
    await symlink(join(root, 'other'), join(root, 'linked'));
    await assert.rejects(
      buildFontAssets({ ...config, outputDir: 'linked/fonts' })
    );
    await assert.rejects(buildFontAssets({ ...config, maxTotalBytes: 65 }));
    assert.equal(
      await readFile(join(root, 'public/fonts/manifest.json'), 'utf8'),
      previous
    );
  }));
test('structured SVG icons are inert; font glyphs require emitted-font coverage', () =>
  fixture(async (root, config) => {
    /** Structured inert SVG fixture with no raw XML or executable attributes. */
    const geometry = {
      viewBox: [0, 0, 24, 24],
      paths: [{ d: 'M0 0 L24 24 Z' }],
    };
    /** Emitted synthetic font/icon manifest with separate asset kinds. */
    const manifest = await buildFontAssets({
      ...config,
      icons: [{ key: 'mark', kind: 'svg', geometry, license }],
    });
    assert.equal(manifest.icons[0].kind, 'svg');
    assert.match(
      await readFile(
        join(root, 'public/fonts', manifest.icons[0].file),
        'utf8'
      ),
      /^<svg/
    );
    /** Fixed SVG serialization of an intentionally hostile label, expected to be escaped. */
    const html = svgIconMarkup(geometry, {
      decorative: false,
      label: '<img src=x onerror=alert(1)>',
    });
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img/);
    assert.throws(() =>
      svgIconMarkup({ viewBox: [0, 0, 24, 24], paths: [{ d: 'M0 0<script>' }] })
    );
    assert.throws(() =>
      svgIconMarkup({
        viewBox: [0, 0, 24, 24],
        paths: [{ d: 'M0 0', fill: 'url(javascript:bad)' }],
      })
    );
    assert.throws(() => fontIcon(10, 'Icons'));
    await assert.rejects(
      buildFontAssets({
        ...config,
        icons: [
          { key: 'glyph', kind: 'font', fontKey: 'regular', codePoint: 65 },
        ],
      }),
      /coverage/
    );
  }));
test('explicit FontTools selection checks axes and subset glyphs; a missing tool fails clearly', () =>
  fixture(async (root, config) => {
    let inspections = 0;
    /** Explicit injected FontTools-shaped fixture; never proof that native FontTools is installed. */
    const tool = {
      name: 'fonttools',
      inspect: async () => ({
        toolVersion: '4.60.0-fixture',
        axes: [{ tag: 'wght', min: 100, default: 400, max: 900 }],
        codePoints: ++inspections === 1 ? [65, 66] : [65],
      }),
      subset: async (bytes) => {
        /** Copied subset bytes or emitted manifest observed in the bounded tool fixture. */
        const result = new Uint8Array(bytes);
        result[63] = 7;
        return result;
      },
    };
    /** Explicit synthetic face list, including invalid/remote/subset cases under test. */
    const fonts = [
      {
        ...font,
        weight: '100 900',
        axes: [{ tag: 'wght', min: 100, default: 400, max: 900 }],
        subset: { codePoints: [65], language: 'en', script: 'Latn' },
      },
    ];
    /** Copied subset bytes or emitted manifest observed in the bounded tool fixture. */
    const result = await buildFontAssets({
      ...config,
      fonts,
      tool,
      icons: [
        { key: 'letter', kind: 'font', fontKey: 'regular', codePoint: 65 },
      ],
    });
    assert.notEqual(result.fonts[0].sha256, result.fonts[0].sourceSha256);
    assert.deepEqual(result.fonts[0].subset.codePoints, [65]);
    assert.equal(result.fonts[0].tool.version, '4.60.0-fixture');
    inspections = 0;
    await assert.rejects(
      buildFontAssets({
        ...config,
        fonts,
        tool,
        icons: [
          { key: 'missing', kind: 'font', fontKey: 'regular', codePoint: 66 },
        ],
      }),
      /glyph missing/
    );
    inspections = 0;
    await assert.rejects(
      buildFontAssets({
        ...config,
        fonts,
        tool: {
          ...tool,
          inspect: async () => ({
            toolVersion: '4.60.0-fixture',
            axes: [{ tag: 'wght', min: 100, default: 400, max: 900 }],
            codePoints: [],
          }),
        },
      }),
      /lacks requested glyphs/
    );
    await assert.rejects(
      createFontToolsTool({ executable: join(root, 'missing-python') }).inspect(
        fontBytes(),
        'woff2'
      ),
      /FontTools unavailable/
    );
    /** Already-aborted caller signal expected to reject before native tool work. */
    const signal = new AbortController();
    signal.abort();
    await assert.rejects(
      createFontToolsTool().inspect(fontBytes(), 'woff2', signal.signal),
      /cancelled/
    );
  }));
test('output lease rejects overlapping builds and cancelled acquisition drains before cleanup', () =>
  fixture(async (root, config) => {
    await buildFontAssets(config);
    /** Previous successful manifest bytes which failed candidates must preserve. */
    const previous = await readFile(
      join(root, 'public/fonts/manifest.json'),
      'utf8'
    );
    let release, started;
    /** Barrier proving the first build owns the lease before the competing build starts. */
    const ready = new Promise((r) => (started = r));
    /** Fixture-controlled acquisition settlement, released before teardown drains the build. */
    const waiting = new Promise((r) => (release = r));
    /** Owned cancellation controller for the held synthetic acquisition. */
    const controller = new AbortController();
    let cancelled = 0;
    /** Injected build-only transport; no live provider or host credentials are used. */
    const remote = {
      allowedOrigins: ['https://approved.test'],
      fetch: async () => {
        started();
        await waiting;
        return new Response(
          new ReadableStream({
            cancel() {
              cancelled++;
            },
          })
        );
      },
    };
    /** Explicit held build inputs using only injected remote transport. */
    const current = {
      ...config,
      fonts: [{ ...font, source: { url: 'https://approved.test/font' } }],
      remote,
      signal: controller.signal,
    };
    /** Active build promise retained until cancellation and actual settlement. */
    const work = buildFontAssets(current);
    try {
      await ready;
      await assert.rejects(buildFontAssets(config), /locked/);
      controller.abort();
      release();
      await assert.rejects(work, /acquisition failed/);
      assert.equal(cancelled, 1);
      assert.equal(
        await readFile(join(root, 'public/fonts/manifest.json'), 'utf8'),
        previous
      );
      assert.equal(
        (await readdir(root)).some((name) => name.startsWith('.font-')),
        false
      );
    } finally {
      // Release and settle the held transport before outer cleanup can remove its leased directory.
      controller.abort();
      release();
      await work.catch(() => {});
    }
  }));
