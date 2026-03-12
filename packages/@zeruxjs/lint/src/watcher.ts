import { startWatcher } from "@zeruxjs/watcher";

export function watchFiles(callback: () => void) {
    startWatcher(process.cwd(), () => {
        callback();
    });
}