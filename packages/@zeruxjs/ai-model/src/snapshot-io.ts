import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, unlink, lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
const LIMIT = 32 * 1024 * 1024;
async function checkTarget(file: string) {
    try {
        if (!(await lstat(file)).isFile())
            throw new TypeError('Unsafe knowledge snapshot path');
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            throw error;
    }
}
export async function writeBoundedSnapshot(snapshot: unknown, file: string): Promise<void> {
    const content = JSON.stringify(snapshot);
    if (Buffer.byteLength(content) > LIMIT)
        throw new RangeError('Knowledge snapshot too large');
    await mkdir(dirname(file), { recursive: true });
    await checkTarget(file);
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
        const handle = await open(temp, 'wx', 0o600);
        try {
            await handle.writeFile(content);
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        await checkTarget(file);
        await rename(temp, file);
    }
    catch (error) {
        await unlink(temp).catch(() => { });
        throw error;
    }
}
export async function readBoundedSnapshot(file: string): Promise<unknown> {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    let snapshot: unknown;
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > LIMIT)
            throw new TypeError('Invalid knowledge snapshot file');
        const chunks: Buffer[] = [];
        let length = 0;
        while (true) {
            const buffer = Buffer.alloc(65536), read = await handle.read(buffer, 0, buffer.length, null);
            if (!read.bytesRead)
                break;
            length += read.bytesRead;
            if (length > LIMIT)
                throw new RangeError('Knowledge snapshot too large');
            chunks.push(buffer.subarray(0, read.bytesRead));
        }
        snapshot = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length)));
    }
    finally {
        await handle.close();
    }
    return snapshot;
}
