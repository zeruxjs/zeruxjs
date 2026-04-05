import fs from "node:fs";
import path from "node:path";

export const SCRIPT_EXTENSIONS = [".ts", ".js", ".mjs", ".cjs"] as const;

const IGNORED_DIRECTORIES = new Set([
    ".git",
    ".next",
    ".zerux",
    "coverage",
    "dist",
    "node_modules"
]);

export const toPosixPath = (value: string) => value.split(path.sep).join("/");

export const ensureDirectory = (targetPath: string) => {
    fs.mkdirSync(targetPath, { recursive: true });
};

export const isScriptFile = (filePath: string) => {
    if (filePath.endsWith(".d.ts")) return false;
    return SCRIPT_EXTENSIONS.some((extension) => filePath.endsWith(extension));
};

export const findExistingFile = (basePath: string, candidates: readonly string[]) => {
    for (const candidate of candidates) {
        const absolutePath = path.join(basePath, candidate);
        if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
            return absolutePath;
        }
    }

    return null;
};

export const findScriptEntry = (basePath: string, name = "index") =>
    findExistingFile(
        basePath,
        SCRIPT_EXTENSIONS.map((extension) => `${name}${extension}`)
    );

export const walkDirectory = (directoryPath: string): string[] => {
    if (!fs.existsSync(directoryPath)) return [];

    const stat = fs.statSync(directoryPath);
    if (!stat.isDirectory()) return [];

    const files: string[] = [];

    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (IGNORED_DIRECTORIES.has(entry.name)) continue;
            files.push(...walkDirectory(path.join(directoryPath, entry.name)));
            continue;
        }

        const fullPath = path.join(directoryPath, entry.name);
        if (isScriptFile(fullPath)) {
            files.push(fullPath);
        }
    }

    return files.sort();
};

export const importModule = async (filePath: string, mode: "dev" | "start") => {
    const moduleUrl = new URL(`file://${filePath}`);
    if (mode === "dev") {
        moduleUrl.searchParams.set("t", `${Date.now()}`);
    }

    return import(moduleUrl.href);
};
