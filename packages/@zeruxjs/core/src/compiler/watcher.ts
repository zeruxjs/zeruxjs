import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function startWatcher(rootDir: string, onChange?: (event: { file: string; type: string }, type: string) => void) {
    console.log("Watcher started:", rootDir);

    const watchDir = path.join(rootDir);
    const fileHashes = new Map();
    const debounceTimers = new Map();

    fs.watch(watchDir, { recursive: true }, (event: string, file: string | null) => {
        if (!file) return;

        const filePath = path.join(watchDir, file);

        const timer = debounceTimers.get(filePath);
        if (timer) clearTimeout(timer);

        debounceTimers.set(filePath, setTimeout(() => {
            debounceTimers.delete(filePath);

            let stat;
            try {
                stat = fs.statSync(filePath);
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    fileHashes.delete(filePath);
                    console.log(`File changed: ${file} (delete)`);
                    onChange?.({ file, type: "delete" }, "delete");
                }
                return;
            }

            if (stat.isDirectory()) return;

            let content;
            try {
                content = fs.readFileSync(filePath);
            } catch {
                return;
            }

            const currentHash = crypto.hash("md5", content, "hex");
            const prevHash = fileHashes.get(filePath);

            let type = "update";

            if (!prevHash) {
                type = event === "rename" ? "new" : "update";
            } else if (prevHash === currentHash) {
                type = "resave";
            }

            if (type !== "resave") {
                fileHashes.set(filePath, currentHash);
            }

            console.log(`File changed: ${file} (${type})`);

            onChange?.({ file, type }, type);

        }, 50)); // 50ms snappier debounce
    });
}