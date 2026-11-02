# @zeruxjs/font

Modular font-face generation and browser font loading.

```ts
import { createFontRegistry, fontPreload, loadFont } from "@zeruxjs/font";
const fonts = createFontRegistry();
fonts.add("regular", { family: "Inter", sources: [{ url: "/fonts/inter.woff2", format: "woff2" }] });
const css = fonts.css();
```

The core registry generates CSS; it does not download or bundle font files. The separate opt-in build pipeline below vendors approved assets. Sources are validated, and browser font loading requires a DOM.

## Font stylesheet endpoint

```ts
import { createFontRegistry } from '@zeruxjs/font';
import { createFontStylesheetHandler } from '@zeruxjs/font/http';
const registry = createFontRegistry();
registry.add('ui', { family: 'Inter', sources: [{ url: '/fonts/inter.woff2', format: 'woff2' }] });
const endpoint = createFontStylesheetHandler({ registry, preloadKeys: ['ui'], cacheSeconds: 600 });
```

Generates a CSS `@font-face` stylesheet with ETag/304 and HEAD, optional bounded `Link: preload` headers and cache policy. Font binary hosting, licensing, Content Security Policy and font optimization remain application/deployment responsibilities. Only trusted font definitions should be registered.

## Build-time font assets

`@zeruxjs/font/build` is an explicit Node-only pipeline; the core registry still only generates CSS and loads browser fonts. No font is downloaded, tool launched or file written on import. `buildFontAssets` accepts a trusted project root, relative destination and canonical public base path, and returns a version-1 manifest.

```ts
import {buildFontAssets} from '@zeruxjs/font/build';
import type {FontLicense} from '@zeruxjs/font/build';

export async function vendorBrandFont(
  projectRoot: string, source: {path: string; family: string; license: FontLicense}
) {
  return buildFontAssets({
    projectRoot, outputDir: 'public/fonts', publicBase: '/app/fonts/',
    fonts: [{key: 'brand', family: source.family, source: {path: source.path},
      format: 'woff2', weight: 400, style: 'normal', display: 'swap',
      license: source.license, preload: true}],
    preload: {maxCount: 2, maxBytes: 128 * 1024}
  });
}
```

The source must be an approved local WOFF2 font in this example. WOFF, TrueType and OpenType are also supported by their explicit `format` values. Container signatures are checked, **not complete font conformance**; use the optional inspector to validate actual variable axes/glyph inventory. No font files are supplied or licensed by this package.

Every font/SVG source requires `{id,source,attribution,redistributionAllowed:true,text?}` license metadata. `source` is a public HTTPS attribution URL without credentials/query/fragment, or a `local:...` provenance label. Raw local paths and authenticated download URLs are never placed in the manifest. Include required copyright/license text/notices and satisfy all license conditions before setting the flag; this is a host declaration, not legal verification. `subsettingAllowed:true` is additionally required for subsetting. Reserved font names, modifications and vendor restrictions remain the host's responsibility. Do not redistribute an asset merely because it can be fetched.

The pipeline emits SHA-256-named binary files, a SHA-256-named stylesheet, optional SVG assets and `manifest.json`. Font entries include key, family, style/weight, format, bytes, source/output hashes, URL/file, declared verified axes, subset coverage/tool version when used, and attribution/license metadata. The manifest digest covers its deterministic content with an empty digest field. Source order does not affect sorted CSS/manifest output. Identical font bytes share one binary/cache identity, while face/license records remain separate. Use `manifest.css.url` and `manifest.preloads` rather than guessing URLs. The mutable `manifest.json` needs a suitable revalidation policy; hashed assets may use immutable caching under host control.

Default budgets: 64 font faces, 256 icons, 8 MiB per font (maximum 16 MiB), 64 MiB emitted output (maximum 128 MiB), two preload URLs/128 KiB (maximum 16 URLs/16 MiB). Preload requests exceeding either budget fail rather than silently widening it; identical binary URLs count once. A preload manifest is descriptive, not automatic HTML/header injection.

Face validation accepts weights 1–1000 (including ordered variable ranges and normal/bold), normal/italic/oblique styles with bounded ordered degree ranges, bounded named/percentage stretch, validated Unicode ranges and bounded four-character feature/variation settings. Display is an explicit allowlist. Duplicate keys, equivalent overlapping family/weight/style/stretch selections, duplicate axis tags and invalid ranges reject. Unicode-range-disjoint faces with otherwise overlapping selections are conservatively rejected; this is not the whole CSS Fonts grammar. Generic registry upsert/insertion ordering remains compatible, but previously accepted invalid CSS now fails. See [CSS Fonts](https://drafts.csswg.org/css-fonts/).

The destination must stay within the canonical existing project root. Source files and output ancestors reject traversal/symlinks; files are opened without following symlinks. Each build owns a per-output lease and private sibling staging directory. Only a complete valid candidate is promoted; pre-promotion acquisition/validation/output-budget failure leaves the previous directory intact. Cleanup removes owned staging/leases, not unrelated files. Promotion uses same-filesystem rename with a rollback directory, **not a crash-atomic deployment transaction**. Stale locks/backups after a process crash require operator reconciliation; no automatic stale-owner deletion is performed. The directory owner is trusted, so these checks are not a sandbox against a hostile filesystem owner racing ancestor replacements. Build outputs use restricted owner permissions; configure serving/deployment permissions deliberately.

Run/await this pipeline before `zerux build`, placing output under a configured public root. The inspected framework builder copies such static files and includes them in its public asset manifest; it does not invoke this pipeline or invent font preloads. Match `publicBase` to the actual non-root hosting mount. Do not run both writers concurrently over staging files or rebuild user-managed applications implicitly. The docs app remains its own exporter. Deployment/cache retention of prior hashed files for active clients is separate from replacing this local build directory.

## Optional remote acquisition and subsetting

Remote sources are direct font binaries, not provider stylesheets or executable discovery endpoints. Opt in with `remote:{fetch,allowedOrigins,maxRedirects?,timeoutMs?}` and `source:{url}`. The injected transport is required, HTTPS origins are exact/allowlisted (maximum 32), redirects are manual and reapproved at every step (default two, maximum five), credentials are omitted and encoded responses reject. Default wall deadline is 15 seconds (maximum 120 seconds); per-file and declared/actual-length limits still apply. Readers are cancelled/released on failures, redirects, size/deadline/cancellation errors. A transport that already followed redirects rejects. Errors omit transport details/download URLs. Host transport/DNS/firewall policy must prevent SSRF/rebinding; URL allowlisting is not IP pinning. Signals/deadlines are cooperative, so a nonconforming injected Fetch can delay settlement and retain the build lease.

After vendoring, emitted CSS references only the configured local public base. Serving the directory requires no provider access or remote fetch. Provider acquisition needs its own live qualification; no Google/Adobe/all-provider mirroring, CSS discovery, authenticated licensing flow or CDN parity is claimed.

`createFontToolsTool({executable?,timeoutMs?})` explicitly selects the maintained [FontTools subsetter](https://fonttools.readthedocs.io/en/stable/subset/index.html). It requires a host-installed POSIX Python 3 with FontTools major version 4+ and the compression dependencies needed for the chosen format (including Brotli for WOFF2). It never installs packages. It invokes a fixed isolated Python program with shell disabled, a minimal PATH/LANG environment rather than application credentials, and JSON/bytes over stdin/stdout—no user font paths, Python source or tool arguments are accepted. The trusted operator chooses the executable; do not expose that configuration to HTTP clients. The process is bounded to 512 MiB address space, 30 CPU seconds, no filesystem writes and a wall timeout up to 30 seconds, and is killed/reaped on cancellation/limit failure. This is a bounded parser subprocess, not a general-purpose sandbox against a compromised tool installation.

Pass `tool` when declaring `axes:[{tag,min,default,max}]` or `subset:{codePoints,language?,script?}`. Axes are checked against actual `fvar` inspection before and after processing; selected weights must fit the declared `wght` range. Custom tags are four ASCII letters. Variable-axis metadata is not inferred from a filename. Subsets require an explicit finite list of up to 65536 Unicode scalar values, not automatically generated language/script tables. `language`/`script` are validated attribution hints; they do not prove complete linguistic coverage. Source and emitted cmap coverage (excluding glyph zero/.notdef mappings) must include every requested code point, and selected font icons must exist in the **emitted** subset. Complex shaping, layout-feature preservation, hinting and display quality need separate FontTools/font/browser qualification; code-point presence alone does not prove correct shaping. Tool version and original/output hashes are retained for provenance.

The tool is optional and inert until chosen. Without it, ordinary static copying works, while variable-axis, subsetting and font-icon coverage requests fail clearly rather than bypass inspection. A host may inject the same `FontToolsTool` contract for a separately qualified FontTools environment; declarations/fixture results are not proof that its implementation uses the maintained tool.

## Separate icon registration

Build icons use either `{key,kind:'font',fontKey,codePoint}` or `{key,kind:'svg',geometry,license}`. Font icons reference a registered face and need verified emitted glyph coverage. `fontIcon(codePoint,family)` returns plain glyph text plus a validated CSS family; set textContent/style properties and provide an accessible host label or decorative semantics. It does not emit arbitrary HTML or manufacture a meaningful label.

SVG sources are structured `viewBox` and bounded path data/fills only. `svgIconMarkup(geometry,{decorative?,label?})` generates fixed SVG elements with escaped attributes; meaningful icons require an explicit label. No raw XML/HTML, event attributes, style strings, external href/use, foreignObject or unrestricted remote SVG parsing is accepted. Path characters are constrained for safe rendering, not a complete geometry/conformance validator. Fill is none/currentColor or bounded hex colors. SVG and icon-font assets retain distinct manifest kinds/ownership; use their registered manifest URLs/data.

## Browser entry and qualification

Use native ESM `@zeruxjs/font/browser` for CSS, browser loading and icon helpers without Node imports or ambient Node types. The existing root/http entries remain compatible. `npm run build` emits package-owned declarations and the browser bundle; the existing `dev` command watches TypeScript only, so rerun the build to update that bundle. Browser loading uses the host's FontFaceSet and does not call the build pipeline or provider transport. Styling/CSP, fallback metrics, accessible icon labels and font display/rendering quality remain host responsibilities.

Focused checks cover deterministic/offline output, changed hashes, duplicate families/axes, invalid CSS, license denial, preload/output budgets, unsafe paths, remote failure/redirect/deadline cleanup, output-lease ownership, safe icons and injected glyph-coverage failures. Packed Node-only/DOM-only consumer fixtures verify public exports and declarations. Header fixtures are not real fonts; no font rendering or complete shaping qualification is inferred. Python FontTools is not installed in this environment, so actual native subset/axis parsing and live-provider acquisition remain explicit prerequisites, not claimed successes.

## Opt-in Zuixs font tokens

`@zeruxjs/font/zuix` consumes a registry plus its matching build manifest. The `/registry` entry also provides a DOM-type-free registry for Node-only consumers. It imports no Zuixs runtime, downloads nothing and starts no browser loading. Zuixs' public theme/plugin API is the integration boundary; no changes to its compiler or network behavior are required.

```ts
import {createFontRegistry} from '@zeruxjs/font/registry';
import {createFontZuixAdapter} from '@zeruxjs/font/zuix';
import type {FontAssetManifest} from '@zeruxjs/font/build';
import {createZuix} from 'zuixs';

export function compileFontUtilities(assets: FontAssetManifest) {
  const registry = createFontRegistry();
  for (const face of assets.fonts) registry.add(face.key, {
    family: face.family, weight: face.weight, style: face.style,
    sources: [{url: face.url, format: face.format}], display: 'swap'
  });
  const fonts = createFontZuixAdapter({registry, assets,
    fonts: [{token: 'body', key: 'brand', fallback: ['system-ui', 'sans-serif']}]});
  const utilities = createZuix({preflight: false, theme: fonts.theme,
    plugins: [fonts.plugin]}).generate(['font-family-body', 'font-weight-body']);
  return {css: fonts.css + '\n' + utilities.css, assets: fonts.manifest,
    preloads: fonts.preloads([['body'], ['body']])};
}
```

Use the earlier build example's `brand` face. Write returned CSS as an external stylesheet and reference it through the host build manifest, under the actual mount (e.g. `/app/fonts/`). The returned asset manifest selects only mapped font/icon records, retains hashes/licenses and references the original build digest; it is not a replacement build digest or a new file copier. Serve those referenced binary/SVG files. No inline scripts/styles or CSP relaxation are required. The host still configures `style-src`, `font-src` and `img-src`; no nonce is generated here.

Token names are lowercase ASCII identifiers, at most 48 characters. Duplicate font/icon token names, missing records and registry/manifest mismatches reject. `font-family-NAME` maps to `theme.fontFamily.NAME` with a scoped-name custom property declared on `:root`; `font-weight-NAME` maps to `theme.fontWeight.NAME`. Ranges use their minimum weight as the property default; hosts choose other weights explicitly. Prefix, important and variants are handled by Zuixs. Merge `fonts.theme` with your own config deliberately; Zuixs `extend.fontFamily`/`extend.fontWeight` override these defaults. Later host plugins can override matching utility names. The adapter does not mutate your registry/config. Fallbacks always end in system-ui/sans-serif; fallback layout/appearance still varies by platform. Author overrides own their fallback/CSS validity.

`icons:[{token,key}]` selects separately registered icons. Font icons emit `icon-NAME` family/style/weight utilities, but glyph text remains explicit (`fontIcon(...).text` with `textContent`); accessible labels stay host-owned. SVG icons stay URL/hash records in the selected manifest, rendered with ordinary image semantics or the structured SVG helper, never arbitrary CSS/HTML. The adapter does not turn SVG files into font glyphs or insert generated-content labels.

No faces/icons are selected implicitly. Only selected faces enter `fonts.css`; use a separate adapter per route/build chunk for finer CSS splitting. Merely generating a utility does not call `document.fonts.load`. `fonts.preloads([])` returns none, independent of build-time preload suggestions. Pass explicit per-route token lists in one call to union/deduplicate URLs across routes: default two URLs/128 KiB, hard maxima 16 URLs/16 MiB; excess rejects. SVGs are not font preloads. Route planning is host-owned, with no global preload cache. The HTTP stylesheet handler also deduplicates URLs and rejects overflow through `maxPreloads` (default/hard maximum 16), instead of silently truncating. Its existing ETag follows selected registry CSS changes; core HTTP requires Node while `/browser` remains independent.

Optional browser loading: `createFontLoadScope({document?,maxPending?})` owns load observations for a mount. Call `scope.load(family,{signal?,timeoutMs?,sample?})`, then `scope.dispose()` on teardown. It rejects new observations after disposal, bounds concurrent observations (default 8, maximum 64), clears timers/listeners on every outcome and redacts native failure messages. `loadFont` retains its boolean result; absent DOM/FontFaceSet returns false, failure/cancellation/timeout rejects. Cancellation stops observation and suppresses success delivery, **not the underlying browser font download**: [FontFaceSet.load](https://www.w3.org/TR/css-font-loading-3/) has no AbortSignal parameter. Host/CSS-owned faces are never removed. Native work can continue after observation ends; these limits are not a browser network quota.

A failed configured font leaves the declared fallback stack available; failed icon fonts cannot guarantee an equivalent fallback glyph, so use explicit text/SVG alternatives where meaning matters. `swap` favors visible fallback text but may shift layout; `optional` can retain fallback, while block/fallback have other timing tradeoffs. Match fallback metrics and test actual scripts/weights; no zero-layout-shift guarantee is made. See [CSS Fonts display controls](https://www.w3.org/TR/css-fonts-4/#font-display-desc). These checks use injected FontFaceSet behavior and real Zuixs compilation, not live font rendering, visual layout measurements or browser/network cancellation certification.
