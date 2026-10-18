---
{
  "title": "Utility-first application styling",
  "description": "Set up zuixs with explicit lifecycle, typed public APIs and deployment boundaries.",
  "section": "Packages",
  "order": 210,
  "package": "zuixs",
  "sources": [
    "packages/zuixs/README.md",
    "packages/zuixs/package.json"
  ],
  "related": [
    "packages",
    "typescript",
    "configuration-reference"
  ]
}
---

## Installation and integration path

```sh
npm install zuixs@0.0.2
```

This package has its own public API. Installing it does not create an automatic runtime service key in `zerux.config.js`. Use the framework integration described below or initialize it in the tool/application that owns its lifetime.

## Worked TypeScript setup

```ts
import { createZuix } from 'zuixs';
const compiler = createZuix({
  prefix: 'ui-', darkMode: 'class',
  extend: { colors: { brand: '#5546d9' } },
});
const result = compiler.generate(['ui-p-4', 'ui-rounded-lg', 'ui-bg-brand', 'hover:ui-bg-slate-800']);
if (result.unmatched.length) throw new Error(result.unmatched.join(', '));
console.log(result.css);
```

JavaScript can use the same runtime APIs without type-only statements. Enable JSDoc checking if editor validation is desired; a transpilation step alone does not typecheck the input.

## Usage and configuration

Author component styling in literal utility classes. The compiler generates only matching utilities from the scanned class set and configured safelist. Choose theme tokens and breakpoints centrally; avoid constructing class names dynamically unless the complete tokens are scanned or safelisted. The docs homepage uses literal classes plus global reset/theme declarations.

The CLI/watch/Node/Vite entry points are different integration choices. A stylesheet generator does not automatically inject a browser asset or configure your bundler. Generate the CSS into the application's public/build output and link that output in HTML. The optional recipe API is a Zuixs composition feature, not Tailwind syntax and not required for normal markup.

## Public types

```ts
import { createZuix } from 'zuixs';
type Inputs = Parameters<typeof createZuix>;
type Result = Awaited<ReturnType<typeof createZuix>>;
```

Use installed public declarations and validate untrusted runtime values separately. Avoid deep source imports; the manifest reference below records the actual exported entry points for this version. Generic helpers may preserve a more useful concrete type at the call site than a broad ReturnType alias.

## Failures, ownership and production use

Check unmatched utilities instead of accepting missing styles silently. Production minification can use the TypeScript/esbuild package after generation; Zuixs formatting options alone are not the entire HTML/JS pipeline. Test responsive order, keyboard focus, dark surfaces and reduced motion in a real browser. Compiler value restrictions do not make arbitrary third-party plugin code safe; configuration/plugins remain trusted developer code.

## Verify the integration

Run the real owning application/tool with a normal input and a failure input. Inspect exit status or typed results, then verify cleanup/restart and the installed production entry point. A successful docs build does not exercise child processes, browser APIs, sockets or filesystem permissions on every supported operating system.

## Option reference

### ZuixConfig

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `limits` | `ZuixLimits` | No | Upper bounds for filesystem scanning and CSS token generation. |
| `content` | `string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `exclude` | `string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `output` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `prefix` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `important` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `darkMode` | `'class' \| 'media'` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `preflight` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `minify` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `safelist` | `string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `theme` | `Partial<{[K in keyof ZuixTheme]: ThemeScale}>` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `extend` | `Partial<{[K in keyof ZuixTheme]: ThemeScale}>` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `plugins` | `ZuixPlugin[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `recipes` | `readonly ZuixRecipe[]` | No | Ordered utility recipes, emitted before scanned utility classes. |
| `perFile` | `boolean \| {dir?: string; shared?: boolean}` | No | Emit CSS for each matching source file, with optional shared CSS. |
| `optimize` | `boolean` | No | Remove unneeded spaces and group identical declaration blocks. |
| `keyframes` | `Record<string,string>` | No | Custom reusable animation keyframes (name -> CSS frames body). |
