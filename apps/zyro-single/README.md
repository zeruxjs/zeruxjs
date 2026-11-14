# Historical standalone counter

This private browser example mounts one counter from `src/index.ts` into the root in `index.html`. Its checked-in `src/zyro.js` is a historical generated compatibility bundle, preserved byte-for-byte. It is distinct from the current workspace `zyrojs` public API and does not provide that package’s setup scopes, cancellation or deterministic hydration contracts.

Run `npm run build` once to compile the typed entry to `dist/src/index.js` and copy the historical compatibility runtime, then serve this directory with a trusted static HTTP development host and open its `index.html`. No HTTP server command is supplied here: `npm run dev` starts the TypeScript compiler watcher, and `npm run build` emits compiler output. Neither starts a web server. This review does not rebuild or start the application.

The page’s HTML currently references a Google-hosted font stylesheet, with a sans-serif fallback. It is not an offline-qualified application. No credentials, database, telemetry collector or model provider is configured.

The authored component uses `className` because this historical bundle writes DOM properties directly; `class` would create an unrelated JavaScript property instead of applying the stylesheet.

The legacy runtime retains subscriptions for the page lifetime and has no explicit unmount handle. Do not use it as the reference for new integrations. For current public imports, use the supported workspace package and an explicit owner:

```js
import { signal, effect } from 'zyrojs';

const count = signal(0);
const stop = effect(() => console.log(count.value));
count.value = 1;
stop(); // release this effect when its host owner ends
```

Bare imports require a host bundler or an explicit browser import map; copying this snippet into an unmapped static page is insufficient. See [the current library README](../../packages/zyrojs/README.md) and [the supported standalone generator](../../packages/create/create-zyro-app/README.md) for current rendering modes and cleanup requirements.

Format authored entry/HTML/configuration files and preserve the generated bundle. DOM-emulation checks cannot certify browser keyboard behavior, fonts, layout or assistive technology support.
