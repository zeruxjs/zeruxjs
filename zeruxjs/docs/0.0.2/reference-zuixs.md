# zuixs

Zero-dependency utility-first CSS compiler for ZeruxJS, ZyroJS, React, Vue, Next and Nuxt

# Zuixs

**Zuixs** (Zerux User Interface and Experience) is a utility-first, on-demand CSS compiler. It has no runtime framework dependency and is designed for **ZeruxJS**, **ZyroJS**, React, Vue, Next.js, Nuxt and plain HTML.

## Getting started

```sh
npm run build -w zuixs
node apps/proworkspace/packages/zuixs/dist/cli.js build --cwd apps/proworkspace -o public/zuix.css
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

## Production improvements (0.2)

- **Idempotent output:** classes are deduplicated before generation; identical token inputs emit one rule. Configurable reset and plugin base CSS are emitted once per build.
- **Tree-shaken keyframes:** built-in `spin`, `pulse`, `bounce` and `ping` animation definitions are output only when their matching utilities are present; custom `keyframes` entries are supported.
- **Modern conditions:** `cq-md:`, `container-[min-width:400px]:`, `supports-[display:grid]:`, `media-[width>=700px]:`, `starting:`, `portrait:`, `landscape:`, `forced-colors:`, `contrast-more:`, `rtl:`, `ltr:` and `has-[.active]:` / `not-[.hidden]:`.
- **Modern CSS utilities:** container sizing, scroll snap, overscroll, content-visibility, view transitions, color schemes, field sizing, text wrapping, subgrid, transition behaviors, filters, CSS scroll-driven animations, CSS anchor positioning and other properties via typed arbitrary utilities or `[property:value]`.
- **Per-source CSS:** set `perFile: true` or `{dir:'public/zuix-parts'}`. Each source generates a corresponding `.css` file and a `manifest.json` mapping source files to output. Source-specific files omit preflight, while global output retains reset. Each CSS file is self-contained regarding its own requested utilities; importing global and per-source styles simultaneously intentionally repeats those utilities.
- **Safe writes:** output is written only if changed; stale per-source CSS is removed when its input file disappears.
- **Vite:** scans at build start for production builds, updates changed module classes, and invalidates its virtual stylesheet on edits/deletion. This adapter still uses broad reloads rather than granular HMR.

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

## Section 82 — Production compiler and adapter hardening (source/local gate)

The compiler now rejects malformed/unsafe arbitrary CSS values (including declaration delimiters, comment escapes, `url(...)`, `expression(...)`, control characters and invalid at-rule conditions) instead of concatenating them into CSS. Selectors are CSS-escaped, including leading digits. `unmatched` lists unsupported and rejected class tokens; explicitly safelist classes built at runtime. Plugins (`addBase`, custom keyframes, `addUtilities`) are **trusted application code**, not a sandbox for untrusted CSS.

Generation is bounded through optional `limits` with defaults: `maxFiles: 20000`, `maxFileBytes: 1 MiB`, `maxTotalBytes: 64 MiB`, `maxClasses: 50000`, `maxTokenLength: 256`. Limit failures throw rather than silently produce an incomplete stylesheet. Scanning skips symlink entries and build artefacts; watched files reuse their previous parsed class lists when size/mtime do not change. Outputs must remain under the project root and refuse symlink paths. Per-file manifests remove stale **generated** CSS after a source deletion, not arbitrary files. Configure content/exclude patterns narrowly for large monorepos.

`zuix watch` runs a polling watcher with deterministic regeneration and explicit cleanup; recoverable read/build failures are reported and retried on later polls. `zuix build` rejects unknown flags, missing values and unsupported commands. The framework-neutral Vite adapter tracks current transformed modules in preference to initial scanned data, removes old classes when a file changes, and invalidates its virtual stylesheet on additions/deletions. No eager filesystem import occurs through the browser-safe root entry point.

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
cd apps/proworkspace
npm run test:zuix                # TypeScript, focused tests, npm-pack + offline consumer
npm run test:zuix:browser        # opt-in real Chromium CSS assertion; fails if Chromium cannot launch
npm run test:workspace-tools
npm run verify:source            # source-only; does not certify npm ci
```

`npm run test:zuix` checks tarball contents and installs the packed `zuixs` offline in an isolated consumer, importing `zuixs`, `zuix/node`, `zuix/vite`, and `zuix/theme`. It does not certify a clean workspace installation or actual Vite/Next/Nuxt applications. Chromium fails to render in the current environment; real computed-style screenshots, CSSOM validation across browsers, large-scale memory/load profiling, and full cross-OS tests remain release gates for Sections 82–85. The existing 14 unresolved external workspace dependency resolutions also remain outstanding.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.

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


## Public entry points

Manifest reference for `zuixs@0.0.2`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./node": {
      "types": "./dist/node.d.ts",
      "import": "./dist/node.js"
    },
    "./vite": {
      "types": "./dist/adapters.d.ts",
      "import": "./dist/adapters.js"
    },
    "./theme": {
      "types": "./dist/theme.d.ts",
      "import": "./dist/theme.js"
    }
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {},
  "peerDependencies": {},
  "bin": {
    "zuix": "./dist/cli.js"
  }
}
```


## Implementation sources

- [packages/zuixs/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zuixs/package.json)
- [packages/zuixs/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zuixs/README.md)
