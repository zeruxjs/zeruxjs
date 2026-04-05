import fs from "node:fs";

const parseEnvLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return null;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) return null;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        value = value.slice(1, -1);
    }

    value = value.replace(/\\n/g, "\n");
    return { key, value };
};

export const loadEnvironmentFiles = (envFiles: string[]) => {
    const loadedFiles: string[] = [];

    for (const envFile of envFiles) {
        if (!fs.existsSync(envFile) || !fs.statSync(envFile).isFile()) continue;

        const content = fs.readFileSync(envFile, "utf-8");
        for (const line of content.split(/\r?\n/)) {
            const parsed = parseEnvLine(line);
            if (!parsed) continue;

            if (process.env[parsed.key] === undefined) {
                process.env[parsed.key] = parsed.value;
            }
        }

        loadedFiles.push(envFile);
    }

    return loadedFiles;
};
