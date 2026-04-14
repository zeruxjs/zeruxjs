import { startWatcher } from "zwatch";

export function watchFiles(callback: () => void) {
    startWatcher(process.cwd(), () => {
        callback();
    });
}