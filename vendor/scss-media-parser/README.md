# SCSS media parameter adapter

Repository-owned, independently implemented adapter for Stylelint SCSS's
`operator-no-unspaced` rule. It exposes only the `parse(input).walk(callback)`
interface used by that rule, with `keyword`, `media-feature`, `value`, and `url`
nodes and original UTF-16 source offsets. It is not a general media-query AST.

Strings, escapes, comments, nested parentheses, and Sass interpolation delimiters
are respected when finding feature values and import URLs. No source from
`postcss-media-query-parser` is included. This replaces that dependency because
its distribution omits a complete license notice.

The private package is bundled in `@zeruxjs/lint`; it is not published separately.
Recreate its deterministic npm archive after editing with:

```sh
cd vendor/scss-media-parser
npm pack --ignore-scripts --pack-destination ..
```

The root and private Stylelint bundle lockfiles pin the archive's integrity.
MIT OR Apache-2.0; full license texts are included.
