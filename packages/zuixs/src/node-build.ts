import { commitOutputs, attachManifest } from "./outputs.js";
import { compileStylesheet } from "./stylesheet.js";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createZuix } from "./compiler.js";
import { extractClasses } from "./scanner.js";
import { resolveLimits } from "./safety.js";
import type { ZuixConfig, GenerateResult } from "./types.js";

const supported = /\.(?:html?|jsx?|tsx?|vue|svelte|astro|mdx?)$/i;
const defaultExcluded = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".zerux",
  ".output",
  "coverage",
  ".cache",
  ".zuix",
]);
function globRegex(pattern: string): RegExp {
  let s = "^";
  const normalized = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized.length > 500) throw new Error("zuix: glob too long");
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === "*") {
      if (normalized[i + 1] === "*") {
        i++;
        if (normalized[i + 1] === "/") {
          i++;
          s += "(?:.*/)?";
        } else s += ".*";
      } else s += "[^/]*";
    } else if (ch === "?") s += "[^/]";
    else s += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(s + "$");
}
function expandBraces(pattern:string):string[] {
 if(typeof pattern!=='string'||pattern.length>500)throw new Error('zuix: invalid content glob');
 const queue=[pattern],results:string[]=[];
 while(queue.length){
  const current=queue.pop()!,match=/\{([^{}]+)\}/.exec(current);
  if(!match){results.push(current);continue;}
  const parts=match[1].split(',');
  if(queue.length+results.length+parts.length>100)throw new Error('zuix: too many content globs');
  for(const part of parts)queue.push(current.slice(0,match.index)+part+current.slice(match.index+match[0].length));
 }
 return results;
}
export function createProjectScanner(root: string, config: ZuixConfig = {}) {
  const absoluteRoot = path.resolve(root),
    limits = resolveLimits(config.limits);
  const patterns = (
    config.content?.length
      ? config.content
      : ["**/*.{html,js,jsx,ts,tsx,vue,svelte,astro,md,mdx}"]
  )
    .flatMap(expandBraces)
    .map(globRegex);
  const excluded = (config.exclude ?? []).flatMap(expandBraces).map(globRegex);
  const cache = new Map<
    string,
    { size: number; mtimeMs: number; classes: string[] }
  >();
  const generated=new Set([path.resolve(absoluteRoot,config.output??'zuix.css'),path.resolve(absoluteRoot,(config.output??'zuix.css')+'.map'),...(config.buildManifest?[path.resolve(absoluteRoot,config.buildManifest.file)]:[])]);
  const perFileDir = config.perFile
    ? path.resolve(
        absoluteRoot,
        typeof config.perFile === "object"
          ? (config.perFile.dir ?? "zuix-files")
          : "zuix-files",
      )
    : "";
  function scan(): Map<string, string[]> {
    const files = new Map<string, string[]>();
    let totalBytes = 0,
      visited = 0;
    const nextCache = new Map<
      string,
      { size: number; mtimeMs: number; classes: string[] }
    >();
    function visit(dir: string): void {
      for (const entry of fs
        .readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
        if (++visited > limits.maxFiles * 20)
          throw new Error("zuix: directory traversal limit exceeded");
        if (
          entry.isSymbolicLink() ||
          defaultExcluded.has(entry.name) ||
          entry.name.startsWith(".env")
        )
          continue;
        const abs = path.join(dir, entry.name),
          rel = path.relative(absoluteRoot, abs).split(path.sep).join("/");
        if (generated.has(abs)||excluded.some((p) => p.test(rel))) continue;
        if (entry.isDirectory()) {
          if (abs === perFileDir) continue;
          visit(abs);
        } else if (
          entry.isFile() &&
          supported.test(entry.name) &&
          patterns.some((p) => p.test(rel))
        ) {
          if (files.size >= limits.maxFiles)
            throw new Error("zuix: maxFiles limit exceeded");
          const stat = fs.statSync(abs);
          if (stat.size > limits.maxFileBytes)
            throw new Error(`zuix: maxFileBytes exceeded: ${rel}`);
          totalBytes += stat.size;
          if (totalBytes > limits.maxTotalBytes)
            throw new Error("zuix: maxTotalBytes limit exceeded");
          const old = cache.get(rel);
          const classes =
            old && old.size === stat.size && old.mtimeMs === stat.mtimeMs
              ? old.classes
              : extractClasses(fs.readFileSync(abs, "utf8"), { limits: config.limits });
          files.set(rel, classes);
          nextCache.set(rel, {
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            classes,
          });
        }
      }
    }
    visit(absoluteRoot);
    cache.clear();
    for (const [key, value] of nextCache) cache.set(key, value);
    return files;
  }
  return { scan, invalidate: (file: string) => cache.delete(file), clear: () => cache.clear() };
}
export function scanProjectFiles(
  root: string,
  config: ZuixConfig = {},
): Map<string, string[]> {
  return createProjectScanner(root, config).scan();
}
export function scanProject(root: string, config: ZuixConfig = {}): string[] {
  return [...new Set([...scanProjectFiles(root, config).values()].flat())];
}
function inside(root: string, location: string): boolean {
  const relative = path.relative(root, location);
  return (
    relative !== "" &&
    !relative.startsWith(".." + path.sep) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}
export function outputPath(root: string, target: string): string {
  const location = path.resolve(root, target);
  if (!inside(path.resolve(root), location))
    throw new Error("zuix: output must remain inside project root");
  let current = path.resolve(root);
  for (const segment of path.relative(current, location).split(path.sep)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink())
        throw new Error("zuix: symlink output path denied");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return location;
}
export function buildFromFiles(
  root: string,
  config: ZuixConfig,
  files: Map<string, string[]>,
): GenerateResult {
  const plan = new Map<string,string>();
  const owners = new Map<string,string>();
  const result = createZuix(config).generate(
    new Set([...files.values()].flat()),
  );
  const staleFiles:string[]=[];
  const settings = typeof config.perFile === "object" ? config.perFile : {};
  if (!config.perFile || settings.shared !== false) {
    plan.set(outputPath(root, config.output ?? "zuix.css"), result.css + "\n");
  }
  if (config.perFile) {
    const directory = outputPath(root, settings.dir ?? "zuix-files");
    const manifest: Record<string, string> = Object.create(null);
    for (const [source, classes] of files) {
      const dest = outputPath(root, path.join(directory, config.buildManifest?createHash("sha256").update(source).digest("hex").slice(0,24)+".css":source+".css"));
      if (!inside(directory, dest))
        throw new Error("zuix: invalid source filename");
      const css = createZuix({
        ...config,
        preflight: false,
        safelist: [],
      }).generate(classes).css;
      if(plan.has(dest))throw new Error("zuix: duplicate output");
      plan.set(dest, css + "\n");
      owners.set(dest,source);
      manifest[source] = path.relative(root, dest).split(path.sep).join("/");
    }
    const legacyManifest=outputPath(root,path.join(directory,'manifest.json'));
    const manifestFile=config.buildManifest?outputPath(root,path.join('.zuix',createHash('sha256').update(path.relative(root,directory)).digest('hex').slice(0,24),'manifest.json')):legacyManifest;
    const previousFile=fs.existsSync(manifestFile)?manifestFile:legacyManifest;
    if (fs.existsSync(previousFile)) {
      if(fs.statSync(previousFile).size>resolveLimits(config.limits).maxOutputBytes)throw new Error('zuix: previous manifest too large');
      const previous = JSON.parse(
        fs.readFileSync(previousFile, "utf8"),
      ) as Record<string, string>;
      for (const [source, filename] of Object.entries(previous)) {
        if (
          (Object.hasOwn(manifest, source)&&manifest[source]===filename) ||
          typeof filename !== "string" ||
          !(filename.endsWith(source+".css")||path.basename(filename)===createHash("sha256").update(source).digest("hex").slice(0,24)+".css")
        )
          continue;
        const stale = outputPath(root, filename);
        if (
          inside(directory, stale) &&
          fs.existsSync(stale) &&
          fs.lstatSync(stale).isFile()
        )
          staleFiles.push(stale);
      }
    }
    if(config.buildManifest&&legacyManifest!==manifestFile&&fs.existsSync(legacyManifest))staleFiles.push(legacyManifest);
    if(plan.has(manifestFile))throw new Error("zuix: duplicate output");
    plan.set(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
  }
  attachManifest(root,config,plan,files,name=>outputPath(root,name),owners);
  collectOldMaps(root,plan,staleFiles);
  commitOutputs(plan,resolveLimits(config.limits).maxOutputBytes,staleFiles.filter(file=>!plan.has(file)));
  return result;
}
/** Remove only maps explicitly referenced by an existing generated CSS footer. */
function collectOldMaps(root:string,plan:Map<string,string>,stale:string[]):void {
 for(const file of [...plan.keys(),...stale]){
  if(!file.endsWith('.css')||!fs.existsSync(file))continue;
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>64*1024*1024)throw new Error('zuix: invalid old stylesheet');
  const marker=`/*# sourceMappingURL=${encodeURIComponent(path.basename(file+'.map'))} */`;
  if(!fs.readFileSync(file,'utf8').trimEnd().endsWith(marker))continue;
  const map=outputPath(root,file+'.map');if(!plan.has(map)&&fs.existsSync(map))stale.push(map);
 }
}
/** Output paths cannot escape the project root. */
export function buildZuix(
  root = process.cwd(),
  config: ZuixConfig = {},
): GenerateResult {
  const absolute = path.resolve(root);
  return buildFromFiles(absolute, config, scanProjectFiles(absolute, config));
}
/** Build a CSS import entry with automatic template scanning.
 * @param root Project directory. Input/output must stay inside it without symlink paths.
 * @param input Trusted authored CSS entry relative to root.
 * @param config Optional configuration; no configuration file required.
 * @returns Compilation result. Uses filesystem and process.cwd default, no environment values.
 */
export function buildZuixStylesheet(
  root = process.cwd(),
  input = "src/styles.css",
  config: ZuixConfig = {},
): GenerateResult {
  return buildStylesheetFromFiles(path.resolve(root),input,config,scanProjectFiles(path.resolve(root),config));
}
export function buildStylesheetFromFiles(absolute:string,input:string,config:ZuixConfig,files:Map<string,string[]>):GenerateResult {
  const entry = outputPath(absolute, input),
    destination = outputPath(absolute, config.output ?? "zuix.css");
  const stat = fs.statSync(entry);
  if (!stat.isFile() || stat.size > resolveLimits(config.limits).maxFileBytes)
    throw new Error("zuix: invalid CSS entry size");
  if (entry === destination)
    throw new Error("zuix: CSS input and output must differ");
  const result = compileStylesheet(
    fs.readFileSync(entry, "utf8"),
    [...new Set([...files.values()].flat())],
    config,
  );
  const plan=new Map([[destination,result.css+"\n"]]);
  attachManifest(absolute,config,plan,files,name=>outputPath(absolute,name));
  const stale:string[]=[];collectOldMaps(absolute,plan,stale);
  commitOutputs(plan,resolveLimits(config.limits).maxOutputBytes,stale);
  return result;
}
