import { startWatcher } from "@zeruxjs/tools/watcher";

export function watchFiles(callback: () => void) {
    startWatcher(process.cwd(), () => {
        callback();
    });
}