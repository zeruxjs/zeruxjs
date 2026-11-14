# Themes and rendering preferences

Read explicit theme preferences without assuming a complete component rendering engine.


## Configuration

```ts title="zerux.config.ts"
import type { ZeruxConfig } from 'zeruxjs';
export default {
  theme: { default: 'system', cookieName: 'theme', scriptPosition: 'head' }
} satisfies ZeruxConfig;
```

ThemeMode is light, dark or system. The runtime can process returned HTML and insert configured preference behavior. This is distinct from composing React/Vue components or generating a complete design system.

## Server and browser reads

zeruxjs/theme exports getThemeConfig, getThemeMode, getThemeByPrefersColor, getResolvedTheme, getThemeLabel and getThemeIcon. Server resolution can inspect request cookies and the prefers-color client hint; browser resolution can use matchMedia. Without client information, server output cannot know every user's device preference.

## Preference changes

setTheme updates the browser document and preference cookie; it does nothing when no document exists. Treat a theme cookie as a display preference only, never identity or permission. Ensure your CSS supports the emitted classes and color-scheme behavior.

## Accessible controls

Label the control, keep keyboard focus visible and respect reduced motion. Test first paint and preference changes. If you render different client/server markup based on a theme, account for hydration consistency in the chosen renderer.

## Documentation site policy

This static site uses CSS system preference plus an optional browser-local theme override. It does not execute the framework runtime at request time, and does not claim its static theme control installs the framework theme system.


## Implementation sources

- [packages/zeruxjs/src/theme.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/theme.ts)
- [packages/zeruxjs/src/bootstrap/runtime.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/runtime.ts)
