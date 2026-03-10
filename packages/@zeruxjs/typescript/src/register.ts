import { transformSync } from "esbuild";
import fs from "node:fs";

export function registerTypescript() {
    const loader = (module: any, filename: string) => {
        const source = fs.readFileSync(filename, "utf8");

        const { code } = transformSync(source, {
            loader: "ts",
            format: "esm",
            target: "esnext"
        });

        module._compile(code, filename);
    };

    require.extensions[".ts"] = loader;
}