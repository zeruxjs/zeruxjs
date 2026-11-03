import { compileStylesheet } from "./stylesheet.js";
import { createZuix } from "./compiler.js";
import { extractClasses } from "./scanner.js";
import type { ZuixConfig } from "./types.js";
/** Framework-neutral Vite 5+ plugin. React/Vue/Svelte/Astro work through Vite compilation. */
export function zuixVite(config: ZuixConfig = {}) {
  const virtualId = "virtual:zuix.css",
    resolved = "\0" + virtualId;
  const cssEntries = new Set<string>();
  const modules = new Map<string, Set<string>>();
  let scanned = new Map<string, string[]>(),
    root = "";
  let server:
    | {
        moduleGraph: {
          getModuleById(id: string): unknown;
          invalidateModule(module: unknown): void;
        };
        ws: { send(message: unknown): void };
      }
    | undefined;
  const relative = (id: string) => {
    const pathname = id.split("?")[0].replace(/\\/g, "/");
    if (!root || !pathname.startsWith(root + "/")) return null;
    return pathname.slice(root.length + 1);
  };
  const generate = () => {
    const tokens = new Set<string>();
    for (const [file, values] of scanned)
      if (!modules.has(file)) for (const value of values) tokens.add(value);
    for (const values of modules.values())
      for (const value of values) tokens.add(value);
    return createZuix(config).generate(tokens).css;
  };
  const styleModules = () => [...new Set([...cssEntries,resolved])].flatMap(id=>{
    const module=server?.moduleGraph.getModuleById(id);return module?[module]:[];
  });
  const invalidate = () => {
    const updates: {type:'js-update';path:string;acceptedPath:string;timestamp:number}[]=[];
    for(const module of styleModules()){
      server?.moduleGraph.invalidateModule(module);
      const url=(module as {url?:unknown}).url;
      if(typeof url==='string'&&url.length<=2048&&!/[\r\n]/.test(url))updates.push({type:'js-update',path:url,acceptedPath:url,timestamp:Date.now()});
    }
    if(updates.length)server?.ws.send({type:'update',updates});
  };
  const refresh = async () => {
    const { scanProjectFiles } = await import("./node.js");
    scanned = scanProjectFiles(root, config);
    invalidate();
  };
  return {
    name: "zuix",
    enforce: "pre" as const,
    configResolved(resolvedConfig: { root: string }) {
      root = resolvedConfig.root.replace(/\\/g, "/").replace(/\/$/, "");
    },
    async buildStart() {
      await refresh();
    },
    configureServer(s: typeof server) {
      server = s;
    },
    resolveId(id: string) {
      return id === virtualId ? resolved : null;
    },
    load(id: string) {
      return id === resolved ? generate() : null;
    },
    transform(code: string, id: string) {
      if (
        id.split('?',1)[0].endsWith('.css') &&
        /@import\s+([\"'])zuixs\1\s*;/.test(code)
      ) {
        cssEntries.add(id);
        const tokens = new Set<string>();
        for (const [file, values] of scanned)
          if (!modules.has(file)) for (const value of values) tokens.add(value);
        for (const values of modules.values())
          for (const value of values) tokens.add(value);
        return { code: compileStylesheet(code, tokens, config).css, map: null };
      }
      if (!/\.(?:tsx?|jsx?|vue|svelte|astro|html)$/.test(id.split('?',1)[0]))
        return null;
      const file = relative(id);
      if (!file) return null;
      const next = new Set(extractClasses(code, { limits: config.limits }));
      const old = modules.get(file);
      if (
        !old ||
        next.size !== old.size ||
        [...next].some((c) => !old.has(c))
      ) {
        modules.set(file, next);
        invalidate();
      }
      return null;
    },
    watchChange(id: string, change: { event: string }) {
      const file = relative(id);
      if (!file) return;
      if (change.event === "delete") {
        modules.delete(file);
        scanned.delete(file);
        invalidate();
      } else if (change.event === "create") {
        return refresh();
      }
    },
    async handleHotUpdate(ctx: { file: string; read?:()=>Promise<string>; modules?:unknown[] }) {
      const file=relative(ctx.file);if(!file)return;
      if(ctx.read&&/\.(?:tsx?|jsx?|vue|svelte|astro|html)$/.test(file))modules.set(file,new Set(extractClasses(await ctx.read(),{limits:config.limits})));
      invalidate();
      // Include the source's own affected modules and only Zuixs stylesheet modules.
      return [...new Set([...(ctx.modules??[]),...styleModules()])];
    },
    closeBundle() {
      cssEntries.clear();
      modules.clear();
      scanned.clear();
      server = undefined;
    },
  };
}
/** Browser-only injection; call cleanup on unmount. */
export function injectZuix(
  classes: Iterable<string>,
  config: ZuixConfig = {},
): () => void {
  if (typeof document === "undefined") return () => {};
  const style = document.createElement("style");
  style.setAttribute("data-zuix", "");
  style.textContent = createZuix(config).generate(classes).css;
  document.head.appendChild(style);
  return () => style.remove();
}
/** Escaped inline SSR style. Prefer a nonce/external CSS for strict CSP. */
export function renderZuixStyle(
  classes: Iterable<string>,
  config: ZuixConfig = {},
): string {
  const css = createZuix(config)
    .generate(classes)
    .css.replace(/<\/style/gi, "<\\/style");
  return `<style data-zuix>${css}</style>`;
}
