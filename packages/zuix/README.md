# Zuix

**Zuix** (Zerux User Interface and Experience) is a utility-first, on-demand CSS compiler. It has no runtime framework dependency and is designed for **ZeruxJS**, **ZyroJS**, React, Vue, Next.js, Nuxt and plain HTML.

## Getting started

```sh
npm run build -w zuix
node apps/proworkspace/packages/zuix/dist/cli.js build --cwd apps/proworkspace -o public/zuix.css
```

In a consuming package, install `zuix` and use the `zuix` binary. Add the generated stylesheet in the application's HTML root/layout. For dev regeneration, use `zuix watch -c zuix.config.mjs`. The CLI scans `html`, `js`, `jsx`, `ts`, `tsx`, `vue`, `svelte`, `astro`, `md` and `mdx` by default and skips common build directories. Set `content` to constrain scanning on large projects.

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
import { createZuix, generateCSS, extractClasses, injectZuix } from 'zuix';
import { buildZuix, watchZuix, scanProject } from 'zuix/node';

const result = createZuix({ preflight: false }).generate(['p-4','hover:bg-blue-600']);
console.log(result.css, result.unmatched);
// SSR: renderZuixStyle(classes); Browser/ZyroJS: injectZuix(classes)
```

For a Vite-based app (including Vue, React, or Nuxt in Vite mode), use `zuixVite()` from `zuix/vite`, and import `virtual:zuix.css`. The plugin is an early integration point; for reliable production builds with dynamically generated strings, prefer the CLI scanner and explicit `safelist` values.

## Utilities

Includes spacing, sizes, flex/grid/layout, typography, colors, palette shades, background, border, shadow, radii, positioning, overflow, display, responsive breakpoints, dark mode, pseudo states, group/peer states, arbitrary values (`w-[35px]`) and property utilities (`[scroll-margin-top:2rem]`). Variants can be chained, e.g. `md:dark:hover:bg-blue-700`. The `!` modifier marks declarations important. Responsive defaults: `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px, `2xl` 1536px.

```ts
import type { ZuixPlugin } from 'zuix';
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
