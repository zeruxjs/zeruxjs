import fs from "node:fs";
import path from "node:path";

export function createTsConfig(rootDir: string) {
    const file = path.join(rootDir, "tsconfig.json");

    if (fs.existsSync(file)) return;

    const config = {
        compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true
        }
    };

    fs.writeFileSync(file, JSON.stringify(config, null, 2));
}