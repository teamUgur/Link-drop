import {mkdir, mkdtemp, readdir, rm, stat} from "node:fs/promises";
import path from "node:path";

export type TempDir = { path: string; remove: () => Promise<void> };

export async function createTempDir(root: string): Promise<TempDir> {
    await mkdir(root, {recursive: true});
    const dir = await mkdtemp(path.join(root, "job-"));
    let removed: Promise<void> | undefined;
    return {
        path: dir,
        // Идемпотентно: удаление зовут и из finally, и из обработчика закрытия ответа.
        remove: () => (removed ??= rm(dir, {recursive: true, force: true})),
    };
}

// Корень принадлежит одному процессу api, поэтому всё, что осталось от прошлого запуска
// (kill -9, OOM), на старте — мусор. Для нескольких реплик на общем диске так нельзя: нужен
// каталог на реплику.
export async function cleanTempRoot(root: string): Promise<void> {
    await mkdir(root, {recursive: true});
    const entries = await readdir(root);
    await Promise.all(entries.filter((e) => e.startsWith("job-")).map((e) => rm(path.join(root, e), {recursive: true, force: true})));
}

export async function dirSize(dir: string): Promise<number> {
    let total = 0;
    for (const entry of await readdir(dir, {withFileTypes: true})) {
        if (!entry.isFile()) continue;
        try {
            total += (await stat(path.join(dir, entry.name))).size;
        } catch (e) {
            // yt-dlp переименовывает .part → итоговый файл между readdir и stat — это не ошибка.
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
    }
    return total;
}
