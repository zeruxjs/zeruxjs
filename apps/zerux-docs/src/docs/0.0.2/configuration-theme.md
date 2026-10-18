---
{
  "title": "Runtime theme configuration",
  "description": "Configure server/browser theme helpers and distinguish them from the static docs appearance control.",
  "section": "Configuration",
  "order": 145,
  "sources": [
    "packages/zeruxjs/src/index.ts",
    "packages/zeruxjs/src/bootstrap/services.ts"
  ],
  "related": [
    "themes",
    "styling",
    "frontend-ssr",
    "configuration"
  ]
}
---

## Runtime theme options

```ts title="zerux.config.ts"
import type { ZeruxConfig } from 'zeruxjs';
const theme = {
  default: 'system', cookieName: 'theme',
  disablePreferenceHeader: false,
  scriptPosition: 'head', scriptType: 'module', scriptLoadType: 'async',
} satisfies NonNullable<ZeruxConfig['theme']>;
export default { theme } satisfies ZeruxConfig;
```

The same object works in JavaScript with a JSDoc config annotation. This is configuration for the framework theme helpers, not a replacement for Zuixs CSS generation or application component classes. The docs static app currently uses its own shared localStorage-based appearance control; that behavior does not demonstrate runtime cookie-based theme middleware.

## Defaults and compatibility

Valid modes are `light`, `dark` and `system`; an absent or invalid default normalizes to `system`. The cookie name defaults to `theme`. Both `disablePrefrenceHeader` (legacy spelling) and `disablePreferenceHeader` are accepted; the legacy field takes precedence when both are set. Prefer the correctly spelled field in new configuration and avoid setting both.

Script position is `head`, `body-top` or `body`, defaulting to `head`. Type is `module` or `nomodule`, defaulting to `module`. Load type is `async` or `defer`, defaulting to `async`. These options describe injection behavior; they do not make arbitrary theme scripts compatible with a restrictive CSP. Use the application's actual nonce/hash policy where scripts are emitted.

## Ownership and browser behavior

A server resolves theme preference from the relevant request/cookie context. A browser may also have an operating-system preference. Keep preference values validated and do not let an arbitrary cookie value become raw HTML or CSS. Theme cookies are not authentication cookies, but cookie serialization still needs safe names and values.

Apply theme-aware surface, text, border and focus tokens together. Testing only the page background misses hard-coded white inputs or cards. Include the open menu, search dialog, hovered and keyboard-focused states in both schemes. Respect reduced-motion preferences independently of theme.

## Verify the integration

Check the server-rendered preference on the first response, the system fallback with no stored value, explicit light on a dark system, explicit dark on a light system, and a malformed cookie. If a flash appears before paint, inspect script position and stylesheet timing. Static exports have no per-request Node theme resolution, so restore public appearance preferences in a small early browser script or rely on CSS media queries.

## Exact option shapes

The fields below come from the current source declarations. Optional is not a default value. A callback is application code, not a string naming a role.

### ThemeConfig

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `default` | `ThemeMode` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `cookieName` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `disablePrefrenceHeader` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `disablePreferenceHeader` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `scriptPosition` | `"head" \| "body-top" \| "body"` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `scriptType` | `"module" \| "nomodule"` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `scriptLoadType` | `"async" \| "defer"` | No | Passed using this declared shape; omission is allowed only when marked optional. |

### ResolvedThemeConfig

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `default` | `ThemeMode` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `cookieName` | `string` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `disablePrefrenceHeader` | `boolean` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `scriptPosition` | `"head" \| "body-top" \| "body"` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `scriptType` | `"module" \| "nomodule"` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `scriptLoadType` | `"async" \| "defer"` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
