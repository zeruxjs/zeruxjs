# Zuixs

**Zuixs** (Zerux User Interface and Experience) is a utility-first, on-demand CSS compiler. It has no runtime framework dependency and is designed for **ZeruxJS**, **ZyroJS**, React, Vue, Next.js, Nuxt and plain HTML.

## Getting started

```sh
npm install zuixs
npx zuix build -o public/zuix.css
```

In a consuming package, install `zuixs` and use the `zuix` binary. Add the generated stylesheet in the application's HTML root/layout. For dev regeneration, use `zuix watch -c zuix.config.mjs`. The CLI scans `html`, `js`, `jsx`, `ts`, `tsx`, `vue`, `svelte`, `astro`, `md` and `mdx` by default and skips common build directories. Set `content` to constrain scanning on large projects.

```js
// zuix.config.mjs
export default {
  content: ['app/**/*.{ts,tsx,html}', 'src/**/*.{js,jsx,vue}'],
  output: 'public/zuix.css',
  darkMode: 'class',
  extend: { colors: { brand: '#2563eb' } },
  safelist: ['hidden', 'md:flex', 'dark:bg-slate-900']
};
```

```html
<div class="mx-auto max-w-full p-6 flex flex-col gap-4 bg-white dark:bg-slate-900 md:flex-row">
  <button class="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus-visible:ring-blue-500">Save</button>
</div>
```

## API

```ts
import { createZuix, generateCSS, extractClasses, injectZuix } from 'zuixs';
import { buildZuix, watchZuix, scanProject } from 'zuixs/node';

const result = createZuix({ preflight: false }).generate(['p-4','hover:bg-blue-600']);
console.log(result.css, result.unmatched);
// SSR: renderZuixStyle(classes); Browser/ZyroJS: injectZuix(classes)
```

For a Vite-based app (including Vue, React, or Nuxt in Vite mode), use `zuixVite()` from `zuixs/vite`, and import `virtual:zuix.css`. The plugin is an early integration point; for reliable production builds with dynamically generated strings, prefer the CLI scanner and explicit `safelist` values.

## Utilities

Includes spacing, sizes, flex/grid/layout, typography, colors, palette shades, background, border, shadow, radii, positioning, overflow, display, responsive breakpoints, dark mode, pseudo states, group/peer states, arbitrary values (`w-[35px]`) and property utilities (`[scroll-margin-top:2rem]`). Variants can be chained, e.g. `md:dark:hover:bg-blue-700`. The `!` modifier marks declarations important. Responsive defaults: `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px, `2xl` 1536px.

```ts
import type { ZuixPlugin } from 'zuixs';
const plugin: ZuixPlugin = ({addUtilities,addBase,theme}) => {
 addUtilities({'.text-brand':{color:theme('colors.brand','#2563eb')}});
 addBase(':root { --app-radius: 8px; }');
};
```

**Limitations:** Static extraction recognizes literal class attributes and common class helpers, not all expressions or runtime-generated class names. Arbitrary values are accepted only from trusted application source code; don't compile raw classes submitted by untrusted users. `zuixVite` is intentionally framework-neutral and does not manage all bundler-specific invalidation cases yet. No changes to the ZeruxJS renderer or ZyroJS internals are required to use the generated CSS.

## Output generation

- **Idempotent output:** classes are deduplicated before generation; identical token inputs emit one rule. Configurable reset and plugin base CSS are emitted once per build.
- **Tree-shaken keyframes:** built-in `spin`, `pulse`, `bounce` and `ping` animation definitions are output only when their matching utilities are present; custom `keyframes` entries are supported.
- **Modern conditions:** `cq-md:`, `container-[min-width:400px]:`, `supports-[display:grid]:`, `media-[width>=700px]:`, `starting:`, `portrait:`, `landscape:`, `forced-colors:`, `contrast-more:`, `rtl:`, `ltr:` and `has-[.active]:` / `not-[.hidden]:`.
- **Modern CSS utilities:** container sizing, scroll snap, overscroll, content-visibility, view transitions, color schemes, field sizing, text wrapping, subgrid, transition behaviors, filters, CSS scroll-driven animations, CSS anchor positioning and other properties via typed arbitrary utilities or `[property:value]`.
- **Per-source CSS:** set `perFile: true` or `{dir:'public/zuix-parts'}`. Each source generates a corresponding `.css` file and a `manifest.json` mapping source files to output. Source-specific files omit preflight, while global output retains reset. Each CSS file is self-contained regarding its own requested utilities; importing global and per-source styles simultaneously intentionally repeats those utilities.
- **Safe writes:** output is written only if changed; stale per-source CSS is removed when its input file disappears.
- **Vite:** scans at build start for production builds, updates changed module classes, and invalidates its virtual stylesheet on edits/deletion. Stylesheet modules are targeted through Vite invalidation/update hooks; this does not certify every Vite/framework version.

```js
export default {
  content: ['src/**/*.{tsx,vue,html}', 'app/**/*.{ts,tsx}'],
  output: 'public/zuix.css',
  perFile: { dir: 'public/zuix-parts' },
  minify: true,
  keyframes: { 'wave': '0%,100%{transform:rotate(0)}50%{transform:rotate(20deg)}' },
  safelist: ['animate-[wave_2s_ease-in-out_infinite]', 'cq-md:grid']
};
```

Run `zuix build --per-file` or `zuix build --per-file-dir public/zuix-parts` to enable per-source builds from the CLI. A lightweight regression suite is available via `npm run test:smoke`.

### Production cautions

This version does **not** claim 100% coverage of every current or experimental CSS grammar. For new properties, arbitrary properties (e.g. `[animation-timeline:view()]`) are a forward-compatible escape hatch, subject to browser support. `@property`, `@layer`, complex selector authoring, custom CSS animations, font faces, and newer spec features should use authored CSS or `addBase` in addition to utility classes. Some modern features require progressive enhancement and browser fallbacks. Source extraction is deliberately static, so safelist runtime-built tokens. Do not pass untrusted input into arbitrary CSS syntax. Minification is structural/whitespace-light, not equivalent to an AST optimizer such as Lightning CSS; do not assume vendor prefixing or complex declaration-level compression.

## Compiler safety and resource limits

The compiler now rejects malformed/unsafe arbitrary CSS values (including declaration delimiters, comment escapes, `url(...)`, `expression(...)`, control characters and invalid at-rule conditions) instead of concatenating them into CSS. Selectors are CSS-escaped, including leading digits. `unmatched` lists unsupported and rejected class tokens; explicitly safelist classes built at runtime. Plugins (`addBase`, custom keyframes, `addUtilities`) are **trusted application code**, not a sandbox for untrusted CSS.

Generation is bounded through optional `limits` with defaults: `maxFiles: 20000`, `maxFileBytes: 1 MiB`, `maxTotalBytes: 64 MiB`, `maxClasses: 50000`, `maxTokenLength: 256`, `maxOutputBytes: 64 MiB` for Node output candidates. Limit failures throw rather than silently produce an incomplete stylesheet. Scanning skips symlink entries and build artefacts; watched files reuse their previous parsed class lists when size/mtime do not change. Outputs must remain under the project root and refuse symlink paths. Per-file manifests remove stale **generated** CSS after a source deletion, not arbitrary files. Configure content/exclude patterns narrowly for large monorepos. Reads inspect
the opened regular file and enforce its byte ceiling, including previous output
and manifests; leaf symlink replacement cannot redirect the read. Hosts still own
project directory permissions—these checks are not an OS filesystem sandbox.

`zuix watch` uses the optional zlook peer with shared subscriptions, native notifications and polling fallback, deterministic regeneration and explicit cleanup; recoverable read/build failures are reported and retried on later polls. `zuix build` rejects unknown flags, missing values and unsupported commands. The framework-neutral Vite adapter tracks current transformed modules in preference to initial scanned data, removes old classes when a file changes, and invalidates its virtual stylesheet on additions/deletions. No eager filesystem import occurs through the browser-safe root entry point.

### Tested integration matrix

| Environment | Supported mechanism | Verification |
| --- | --- | --- |
| Plain HTML / ZeruxJS templates | `zuix build` or `zuix watch`; link generated CSS | Node filesystem/compiler tests |
| ZyroJS DOM templates | Same generated CSS; optional `injectZuix()` / `renderZuixStyle()` | API and packed import tests; live browser pending |
| React + Vite | `zuixVite()` and `import 'virtual:zuix.css'` | Vite hook/transform simulation; real React app pending |
| Vue + Vite | Same Vite adapter | Vite hook simulation; real Vue app pending |
| Next.js | External CLI-generated CSS imported by app layout | No official Next adapter or live Next app certification |
| Nuxt | External CLI-generated CSS through app stylesheet | No official Nuxt adapter or live Nuxt app certification |
| Browser/SSR | Browser style injection and inline SSR style | Node output validation; Chromium CSS rendering pending |

### Reproducible commands

```sh
# Run these workspace checks from the repository root.
npm run test:zuix                # TypeScript, focused tests, npm-pack + offline consumer
npm run test:zuix:browser        # opt-in real Chromium CSS assertion; fails if Chromium cannot launch
npm run test:workspace-tools
npm run verify:source            # source-only; does not certify npm ci
```

`npm run test:zuix` checks tarball contents and installs the packed `zuixs` offline in an isolated consumer, importing `zuixs`, `zuixs/node`, `zuixs/vite`, and `zuixs/theme`. It does not certify a clean workspace installation or actual Vite/Next/Nuxt applications. Browser rendering, CSSOM behavior, large-project resource use and cross-platform compatibility require separate validation in the target environment.

### Responsive cascade

Generated base utilities precede state variants and named responsive variants. Named min-width breakpoints are emitted from smaller to larger, so `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` follows mobile-first behavior regardless of class-token order. Breakpoint comparison uses CSS's standard 16px initial font-size equivalence for `em`/`rem`. Keep breakpoint units consistent for predictable custom scales. The docs and ecosystem homepage use this compiler during static production builds.

## Component and typography recipes

Zuixs is a build-time utility-first alternative for application styling. Use utility classes directly in templates; compose the same utilities into recipes when styling reusable components, browser states or generated Markdown without repeating markup classes. Recipes work with the CLI, watch mode, Vite, Node and browser compilation APIs.

```js
export default {
  prefix: 'ui-',
  extend: { colors: { brand: '#087e65' } },
  recipes: [
    { selector: 'body', apply: ['ui-m-0', 'ui-font-sans'] },
    { selector: '.card', apply: ['ui-rounded-lg', 'ui-p-6', 'ui-bg-white'] },
    { selector: '.card:hover', apply: ['ui-border-brand'] },
    { selector: '.article h2', apply: ['ui-text-2xl', 'ui-font-bold', 'ui-mt-8'] },
    { selector: '.card', apply: ['ui-p-4'], media: '(max-width: 700px)' },
    { selector: '.card', apply: ['ui-grid'], supports: '(display: grid)' },
    { selector: '.card', apply: ['ui-grid-cols-2'], container: '(min-width: 40rem)' },
    { selector: '.navigation', apply: ['ui-hidden'], media: 'print' },
  ],
};
```

`apply` takes an array of **base** utility tokens with the configured prefix, including arbitrary values/properties and important tokens such as `ui-!hidden`. Put hover/focus/pseudo-element selectors and conditions on the recipe rather than embedding variants in its tokens. Each recipe emits one declaration block, preserving application order and `!important`. Recipes run after reset/plugin bases and before scanned utility rules, retaining normal CSS specificity. Multiple matching recipes follow source order. Recipes are included even when their selectors are absent from scanned templates, which supports runtime dialog/search states and generated document content.

`media`, `supports` and `container` conditions can be combined; emitted nesting is media → supports → container. Selectors are trusted developer configuration, never visitor input. The compiler validates bounded selectors/conditions, rejects unsupported/unsafe utility tokens, and bounds both recipe count and total utility applications by `limits.maxClasses`. Invalid recipes throw rather than silently producing incomplete styles. Existing configurations without recipes retain their output. Arbitrary values retain the compiler's restrictions on URLs, declaration escapes and executable CSS.

### Arbitrary value types

`text-[21px]` and `text-[clamp(2rem,4vw,4rem)]` select font size; `border-[2px]` selects border width. Ambiguous CSS variables default to color for `text-[var(--accent)]` and `border-[var(--line)]`. Supply an explicit type when needed: `text-[length:var(--heading-size)]`, `text-[color:var(--accent)]`, `border-[length:var(--stroke)]`, `font-[family:Inter,system-ui,sans-serif]` or `font-[weight:750]`. These use the same value safety checks as other utilities.

### Classes first

Use literal utility classes in templates as the default workflow. The ecosystem homepage and generated package cards demonstrate this approach: global configuration retains only palette/reset/selection rules, with component styles in `class` attributes. Recipes are an optional Zuixs composition API, not Tailwind syntax or a requirement for ordinary markup. The docs renderer currently also uses recipes for generated Markdown and existing document components.

`media-[max-width:_550px]:p-4` supports bounded arbitrary media conditions. Complete conditions such as `media-[(hover:_hover)_and_(prefers-reduced-motion:_no-preference)]:hover:shadow-lg` keep their logical grouping. Simple max-width variants sort from wider to narrower and min-width variants from narrower to wider so responsive utility precedence remains predictable.

## CSS import workflow (no Zuixs configuration file)

Create `src/styles.css`:

```css
@import "zuixs";

:root { --brand: #5546d9; --space: 1.5rem; }
[data-theme="dark"] { --brand: #b6aaff; }

@keyframes reveal {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}

/* Optional composition for generated Markdown or reusable elements. */
.article h2 { @apply text-2xl font-bold mt-8; }
@media (prefers-reduced-motion: no-preference) {
  .entrance { animation: reveal 200ms ease-out; }
}
@supports (display: grid) { .layout { @apply grid gap-4; } }
```

Write literal utility classes directly in HTML, JSX/TSX, Vue, Svelte or other scanned templates:

```html
<main class="grid gap-4 md:grid-cols-2 p-6 bg-[var(--brand)]">
  <article class="entrance rounded-lg p-4">Content</article>
</main>
```

From your application directory:

```sh
npx zuix build -i src/styles.css -o public/zuix.css
npx zuix watch -i src/styles.css -o public/zuix.css
```

Link **the generated output**, not the input CSS. The browser cannot compile utilities itself. Default scanning discovers supported source files under the project directory, excluding build/dependency directories. Watch mode observes both class changes and entry CSS changes; unchanged output is not rewritten. Input and output must be different files inside the project, without symlink paths. `-c` remains optional for recipes, custom theme scales, scanning constraints, plugins or safelists.

With Vite, install `zuixVite()` in the existing Vite configuration and import `./styles.css` from your application entry instead of `virtual:zuix.css`. The plugin processes the Zuixs import before Vite's CSS pipeline. Configure only one generated stylesheet entry to avoid repeating resets/utilities. CLI generation is also suitable for other bundlers without a dedicated adapter.

```ts
import { compileStylesheet, extractClasses } from 'zuixs';
import { buildZuixStylesheet } from 'zuixs/node';

const result = compileStylesheet('@import "zuixs";', extractClasses(html));
// Build-time Node integration: scans templates and writes the output.
buildZuixStylesheet(process.cwd(), 'src/styles.css', { output: 'public/zuix.css' });
```

The import expands in place; authored rules after it can override generated utilities through the normal cascade. Native `:root`, custom properties, `@property`, `@keyframes`, `@media`, `@supports`, `@container`, `@layer`, nesting and animation declarations remain intact, including browser-supported future CSS. Native CSS is trusted application source and is not sanitized like arbitrary utility values. `@apply` accepts existing **base** utilities (including important/arbitrary utilities); use CSS selectors and conditions around it for states and responsive composition. Unsupported applications fail explicitly. Keep ordinary CSS imports before the Zuixs import; resolving their files and vendor prefixing belongs to the consuming bundler. CLI compilation does not inline external stylesheets.

This is Zuixs syntax, not full Tailwind compatibility: Tailwind-specific directives such as `@theme`, `@utility`, `@source` and custom variants are not implemented. Variables work through native CSS and arbitrary values; custom utility/theme extensions still use the optional plugin/config API. Recipes remain supported, including the docs application's generated Markdown styling. No claim of complete Tailwind feature parity is made.

## Feature matrix and bounded syntax

This is a documented Zuixs subset, not Tailwind feature or plugin compatibility.

| Family | Supported examples | Deliberate limits |
| --- | --- | --- |
| Layout | `box-border`, `flow-root`, `flex-wrap-reverse`, `grid-flow-col-dense`, `size-4`, `size-[3rem]`, `w-1/2`, `h-2/3`, `basis-1/4` | Fractions require positive integers up to 999 with numerator no greater than denominator; other sizes use existing theme/arbitrary values |
| Grid lines | `col-start-2`, `col-end-auto`, `row-start-1` | Emit native `grid-column-start/end` and `grid-row-start/end`; no implicit layout engine |
| Typography | `text-start`, `text-end`, `wrap-anywhere`, `whitespace-pre-wrap`, `whitespace-pre-line`, `whitespace-break-spaces`, `break-keep`, `leading-6`, `decoration-wavy`, `decoration-2`, `underline-offset-4` | Numeric decoration/underline offsets are 0–16px; no typography plugin or font loading |
| Forms | `appearance-auto`, `resize-none`, `resize-x`, `resize-y`, `accent-blue-600`, `caret-[var(--caret)]`, `outline-solid` | Native properties only; no automatic form reset, validation, accessible labels or focus-management behavior |
| Containers | `container-inline-size`, existing `container-inline`, `container-name-[card]`, `cq-md:grid`, `cq-card-md:grid` | Named query syntax is Zuixs-specific; names use ASCII letters/digits/underscore/hyphen, start with a letter and are at most 48 characters; reserved CSS keywords reject |
| Arbitrary syntax | `w-[calc(100%_-_2rem)]`, `bg-[rgb(0_0_0/0.5)]`, `[--step2:2rem]`, typed `text-[length:var(--heading)]` | Underscores decode to spaces; quotes, escapes, URLs, comments and declaration/rule delimiters reject; no full property/value semantic validator |
| Variants | `md:dark:hover:`, `motion-reduce:`, `focus-visible:`, `disabled:`, `placeholder:text-slate-500`, named container/state chains | At most 11 variants plus a utility, nesting depth at most 8; no arbitrary variant selectors, named group/peer syntax or user-defined variants |
| Composition | Recipes, trusted plugin utilities, native CSS and `@apply` | No Tailwind `@theme`, `@utility`, `@source`, plugin loading, slash line-height syntax or automatic vendor prefixing |

Minimal public-import example:

```ts
import { createZuix, extractClasses } from 'zuixs';

const source = `<section class="container-inline-size container-name-[card]">
  <input class="w-1/2 accent-blue-600 focus-visible:outline-solid" />
  <p class="cq-card-md:text-start wrap-anywhere leading-6">Public text</p>
</section>`;
const result = createZuix({ preflight: false, limits: { maxClasses: 1000 } }).generate(extractClasses(source));
if (result.unmatched.length) throw new Error('Unsupported utility tokens');
console.log(result.css); // Write/link this CSS during the host build.
```

The container utility establishes a query container on an ancestor; `cq-card-md:` applies to its descendants at the named `md` minimum width. It does not query the target element's own dimensions. Accent/caret utilities style native controls, and logical text alignment follows writing direction. These declarations follow [CSS containment](https://www.w3.org/TR/css-contain-3/), [CSS UI](https://www.w3.org/TR/css-ui-4/) and [CSS text](https://www.w3.org/TR/css-text-4/); support in the user's browser still matters. Native arbitrary properties remain a restricted escape hatch, not proof that a property/value is meaningful in every browser. `placeholder-*` legacy color utilities only set a custom property; use the explicit `placeholder:text-*` variant for actual placeholder text color.

`extractClasses(source, { limits })` now applies the same source-byte, unique-token and token-length bounds as Node/Vite scanning. Helper calls understand balanced nested calls and parentheses inside literal strings, with a maximum nesting depth of 32. Dynamic strings/template interpolation still require explicit safelists; source is never evaluated. Malformed helper expressions are not a general JavaScript parser. Compiler tokens independently require balanced syntax; malformed/unknown tokens appear in `unmatched`, while resource-limit exhaustion throws. Generation also bounds total iterable visits to `16 * maxClasses`, including duplicates, so repeated tokens cannot create unbounded generator work. Direct `utilityFor` returns a fresh validated declaration record or `undefined`.

Cascade order remains reset → plugin bases → needed keyframes → recipes in author order → generated utilities. Equal-specificity explicit utilities therefore follow recipes; higher specificity and `!important` still follow native CSS rules. Plugin utilities override built-in lookups for the same name. Base utilities precede variants, responsive minimum widths sort ascending (including named container breakpoints), and remaining ties use deterministic token ordering rather than HTML class order. No implicit cascade layers are inserted: authored rules after `@import "zuixs"` can override equal-specificity generated declarations; placing rules in native `@layer` follows the browser's layer/important ordering instead. Compound pseudo/condition order is literal and does not imply every syntactically composed selector is meaningful.

Qualification uses exact declaration fixtures and CSS Tree grammar/parser checks, plus existing Node scanner/build/watch and simulated Vite hooks. CSS Tree is a development-only test dependency; the published compiler retains zero runtime dependencies. Real browser computed-style qualification requires a functioning Chromium installation; parser checks do not replace it.

## Shared watch workflow and output manifests

For source/workspace builds, `zlook` is also an explicit development dependency so the build planner compiles its declarations before Zuixs. It remains an optional peer for consumers; ordinary compiler imports do not load or start it.

Install `zlook@0.0.4` when using `zuix watch` or the Node watch API. It is an optional peer, loaded only when watching; ordinary build/core/browser imports do not start or require a watcher. The package remains `zuixs`, the binary remains `zuix`.

```ts
import { watchZuix } from 'zuixs/node';

export async function startStyles(root: string, signal: AbortSignal) {
  const stop = watchZuix(root, {
    content: ['src/**/*.html', 'src/**/*.tsx'],
    output: 'public/css/zuix.css',
    buildManifest: { file: 'public/css/zuix-manifest.json', publicPath: '/catalog/css/' },
  }, result => console.log(result.classes.length), console.error, {
    roots: ['src'], ignored: ['src/generated'], signal,
    debounceMs: 60, pollIntervalMs: 1000,
  });
  await stop.ready;
  return stop; // Host teardown: stop(); await stop.closed;
}
```

The legacy synchronous initial build/callback and callable disposer are preserved. `ready` awaits zlook startup and a fresh reconciliation; `closed` drains subscriptions and actual configuration-loader settlement. `await stop.flush()` forces reconciliation for tests/build orchestration. `await stop.reload(nextConfig)` stages a complete candidate and activates it only after compilation/output success. Each subscription snapshots its own configuration and owns its scanner/token cache. Plugin functions remain explicitly trusted host code; their closures are borrowed, not sandboxed or deep-cloned. zlook shares canonical roots only for identical timing/resource settings; it does not share mutable Zuixs build state. Roots must be existing in-project directories (default `['.']`); ignores are project-relative path prefixes, not glob expressions. Content/exclude globs still control source scanning. Choose narrow roots: zlook subscriber ignores filter notifications but do not prune another subscriber's shared baseline.

Source changes invalidate that source's token cache; deletions remove its classes on full metadata reconciliation. One debounced worker plus one trailing request bounds internal build scheduling. Defaults: 60ms debounce, 500ms polling, zlook's 100000-entry/4096-event limits; `pollingOnly`, `maxEntries` and `maxPendingEvents` can be set explicitly. Overflow/errors clear the extraction cache and request full reconciliation rather than trusting a truncated event batch. This remains metadata-based: writes that preserve size and modification time may be missed, and no rename/chokidar parity is promised. Close during startup or abort through the explicit signal is supported; it never stops a user-managed app.

Configured shared output, source maps, build manifest, per-file directory and `.zuix-*` staging files are excluded from notifications/scanning as applicable, alongside build/dependency directories. Old output locations remain ignored for that subscription after reload. Distinct apps can have different output/ignore settings while sharing the underlying root. Every candidate compiles all shared/per-file CSS before staging any replacement. Changed files use same-directory exclusive temporary files, flush, and rename; ordinary replacement failures roll back already replaced files. Complete multi-file publication is not crash-atomic, and concurrent malicious filesystem writers are outside the trusted project boundary. Stale generated per-file files and explicitly referenced maps are removed after candidate validation, without deleting arbitrary files.

`zuix watch -c zuix.config.mjs` watches that declared config file as trusted executable code; a failed import/validation/build keeps the prior configuration/output. CLI flags remain explicit overrides on reload. The same zlook workflow handles `-i src/styles.css`; CSS-entry and template changes both rebuild, and failed CSS entry compilation retains the prior file. Config imports use content-addressed URLs; imported configuration dependencies are not automatically invalidated, and Node cannot evict ESM modules. After 128 config-file reload attempts the watch reports a recreate-required error; recreate it explicitly. Public hosts can instead supply `{ configFile, loadConfig: async ({ signal }) => nextConfig }`, keeping that file inside a watched root. Loaders must cooperate with cancellation; noncooperative code can delay `closed`. Invalidated results cannot commit after disposal. Observer errors are reported after successful commit, not treated as a rollback of committed styles.

For renderer/build integration use the explicit `ZuixBuildManifest` type from `zuixs`, or read the generated JSON file. Its V1 `stylesheets` list contains stable opaque IDs, mounted URLs, SHA-256 integrity and optional map URLs. The `shared` entry links the global stylesheet; other IDs select per-source artifacts. `publicPath` mounts the shared output directory and must be an absolute slash-terminated path, e.g. `/catalog/css/`. When combined with `perFile`, keep its directory below the shared output directory. Opted-in manifest builds use opaque per-file CSS filenames, and keep the per-source lookup under project-local `.zuix/<output-id>/manifest.json`, outside the served output directory. Legacy builds without the explicit public manifest retain their existing per-file `manifest.json` location and source-path format; never expose that legacy lookup as a public renderer manifest. The host must serve only approved output files, not the whole project, and decides which stylesheets to link. No global renderer selection, implicit framework rebuild or Zyro runtime mutation occurs.

Compare IDs/integrity across manifest generations to replace only affected stylesheet links and remove deleted IDs. Normal HTML `<link rel="stylesheet" href="...">` works without JavaScript. Vite similarly invalidates known stylesheet modules and issues targeted update messages using host-provided module URLs; it no longer broadcasts full-page reloads for every class edit. Its hot-update hook includes the source's own affected modules plus stylesheet modules, leaving unrelated modules alone. Hosts without module URLs retain invalidation for the next load; no fallback full reload is inferred. These hooks are verified by simulation, not a live Vite browser application. See the official [Vite plugin API](https://vite.dev/guide/api-plugin).

Source maps are off by default. With `buildManifest: { ..., sourceMap: true }`, install optional `source-map-js@^1.2.1`. External V3 maps record **file-level ownership at source line 1**, not exact token locations. Reset, authored CSS, recipes and plugin-only rules stay unmapped. Relative source filenames are present only in explicitly enabled maps; source contents require the separate `includeSources: true` option and should remain development-only. Map JSON and CSS count toward `limits.maxOutputBytes`. Disabling maps removes previously generated maps identified by their generated CSS footer; use a fresh production output directory when switching from a source-bearing development build. Hosts must restrict source/map access as appropriate. Source map encoding/consumption follows the [source map format](https://tc39.es/ecma426/2024/); no fabricated fine-grained mappings or production source disclosure by default is claimed.

Source-map generation remains opt-in and requires the patched optional `source-map-js` peer at version 1.2.2 or later within 1.x. It is a build tool dependency, not a browser runtime download.

## Source and lifecycle ownership

The browser-safe compiler path is `scanner` → `compiler` → `utilities`/`families`,
with restricted utility syntax in `safety`. Trusted authored CSS composition lives
in `stylesheet`/`recipes`; it is distinct from utility-value validation. Plugins
execute explicitly registered application code and are not a sandbox.

The Node path separates source-cache staging (`node-build`), complete output plans
and compensating replacement (`outputs`), and subscription/config-loader ownership
(`watch`). A failed scan cannot promote a partial source cache. Output rollback
handles ordinary replacement failures but does not provide crash-atomic multi-file
publication. `stop(); await stop.closed` drains actual owned watch work; cooperative
loader cancellation is required for prompt teardown. Vite borrows the host graph
and socket; its `closeBundle` hook clears adapter-owned state without closing them.
Browser `injectZuix` returns a style-node disposer; pure compiler instances do not
need an invented close method.

`optimize` is retained in the public configuration type for compatibility but is
currently not consumed. Exact duplicate generated rule strings are always removed;
`minify` controls added section newlines and is not an AST minifier.
