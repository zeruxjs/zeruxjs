---
{
  "title": "Utility-first styling with Zuixs",
  "description": "Generate application styles from utilities, theme tokens and reusable component recipes.",
  "section": "Frontend",
  "order": 135,
  "sources": ["packages/zuixs/README.md", "packages/zuixs/src/types.ts", "packages/zuixs/src/recipes.ts", "pages/zuix.config.mjs"],
  "related": ["frontend", "deployment"]
}
---

## Build-time CSS

Zuixs is the ecosystem's utility-first styling compiler. It generates CSS from template classes and reusable utility compositions; it does not require a browser styling runtime. The documentation and ecosystem homepage use it for their entire design. The output is still a stylesheet: browsers use that generated CSS to render utility classes and component selectors.

Use the current workspace implementation when developing in this repository. An installed public release only contains the functionality published with that release. These examples describe the current source implementation.

## Configure your design

Create `zuix.config.mjs` in your application:

```js
export default {
  content: ['src/**/*.html', 'src/**/*.{js,ts,jsx,tsx}'],
  output: 'public/zuix.css',
  prefix: 'ui-',
  extend: {
    colors: { brand: '#087e65' },
    screens: { tablet: '48rem' },
    spacing: { panel: '18px' },
  },
  recipes: [
    { selector: '.article h2', apply: ['ui-text-2xl', 'ui-font-bold', 'ui-mt-8'] },
    { selector: '.button', apply: ['ui-rounded-lg', 'ui-p-3', 'ui-bg-brand', 'ui-text-white'] },
    { selector: '.button:focus-visible', apply: ['ui-[outline:3px_solid_currentColor]', 'ui-outline-offset-[4px]'] },
    { selector: '.navigation', apply: ['ui-hidden'], media: 'print' },
  ],
};
```

Use theme tokens across templates. Arbitrary values such as `ui-p-[13px]` and properties such as `ui-[scroll-margin-top:96px]` cover precise application needs without adding one-off compiler code. Arbitrary values are restricted: declaration escapes, executable CSS and URL-loading values are rejected. Values use underscores for spaces. Prefixes belong on the utility name; an important prefixed utility is `ui-!hidden`.

## Style templates directly

```html
<section class="ui-grid ui-grid-cols-1 tablet:ui-grid-cols-2 ui-gap-4">
  <article class="ui-rounded-lg ui-p-panel ui-bg-white">
    <h2 class="ui-text-brand ui-font-bold">Application overview</h2>
    <a class="button" href="/guide/">Read the guide</a>
  </article>
</section>
```

Base utilities are emitted before responsive variants. Named breakpoints follow increasing min-width order, so larger layouts override smaller ones independently of class attribute order. Keep custom breakpoint units consistent.

## Compose components and document styles

Recipes apply ordinary utilities to reusable selectors. They are useful for generated Markdown, dialog states, pseudo-elements and components whose structure should remain readable. Every application is validated; unknown tokens fail compilation. Use base utility tokens in `apply`, and put states such as `:hover` in the selector. Add `media`, `supports` or `container` conditions for conditional recipes. Combined conditions nest in that order.

Recipes preserve declaration order and importance, and appear before scanned template utilities. Normal CSS specificity still applies: a more specific component selector can override a single utility class. Recipe selectors are trusted developer configuration, never visitor input. Recipes are always emitted, including those used by content created later in the browser; keep them focused because they are not removed by the template scanner.

## Develop and build

The package exposes the `zuix` command after installation. From an application directory:

```sh
zuix watch -c zuix.config.mjs
zuix build -c zuix.config.mjs -o public/zuix.css
```

Link the generated stylesheet from your HTML. For programmatic integration, use `createZuix(config).generate(classTokens)` or the Node build API documented in the package README. The repository's site pipeline generates Zuixs CSS and then uses the TypeScript package's esbuild wrapper to minify production CSS and JavaScript; Zuixs's `minify` option alone primarily controls output formatting.

For this repository, run `npm run dev` or `npm run build` from `pages/`. Tooling workspaces are compiled first from the checkout. Change template classes, `zuix.config.mjs` or `zuix.recipes.mjs`; do not edit generated stylesheet files. The combined development server rebuilds and reloads the browser after source changes. Production exports contain complete HTML and styles and work without JavaScript.
