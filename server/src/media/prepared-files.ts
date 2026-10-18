import {randomUUID} from "node:crypto";
import type {FastifyBaseLogger} from "fastify";
import type {DownloadedFile} from "./service.ts";

type Entry = { file: DownloadedFile; timer: NodeJS.Timeout };

// Готовые файлы между «подготовить» и «забрать». Зачем отдельный шаг: браузер скачивает обычной
// ссылкой (нативный прогресс, файл не копится в памяти вкладки), а ошибки и прогресс работы yt-dlp
// фронт получает через fetch — один GET-запрос не умеет ни того, ни другого.
//
// Id — случайный UUID: он и есть право на файл (как подписанная ссылка), угадать его нельзя.
// Хранится в памяти процесса: инстанс один, файлы и так лежат на его локальном диске; при второй
// реплике нужен sticky-роутинг по id или общее хранилище (S3).
export class PreparedFiles {
    private readonly entries = new Map<string, Entry>();
    private readonly ttlMs: number;
    private readonly limit: number;
    private readonly log: FastifyBaseLogger;

    constructor(ttlMs: number, limit: number, log: FastifyBaseLogger) {
        this.ttlMs = ttlMs;
        this.limit = limit;
        this.log = log;
    }

    put(file: DownloadedFile): string {
        // Потолок по числу файлов держит диск в границах (limit × MAX_FILE_MB), даже если клиенты
        // готовят файлы и не забирают. Вытесняем самый старый: его владелец, скорее всего, уже ушёл —
        // фронт забирает файл сразу, как только тот готов. Отказ новому (BUSY) наказывал бы живого
        // пользователя за брошенные чужие файлы.
        while (this.entries.size >= this.limit) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) break;
            this.remove(oldest, "evicted");
        }
        const id = randomUUID();
        const timer = setTimeout(() => this.remove(id, "expired"), this.ttlMs);
        timer.unref();
        this.entries.set(id, {file, timer});
        return id;
    }

    // Не удаляет: оборванную отдачу можно повторить, пока не истёк TTL.
    get(id: string): DownloadedFile | undefined {
        return this.entries.get(id)?.file;
    }

    // Файл отдан целиком — больше не нужен. Range не поддерживаем, так что докачки по тому же id не будет.
    complete(id: string): void {
        this.remove(id, "delivered");
    }

    get size(): number {
        return this.entries.size;
    }

    async clear(): Promise<void> {
        const files = [...this.entries.values()];
        for (const entry of files) clearTimeout(entry.timer);
        this.entries.clear();
        await Promise.all(files.map((e) => e.file.cleanup()));
    }

    private remove(id: string, reason: string): void {
        const entry = this.entries.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.entries.delete(id);
        // Удаление каталога не мешает идущей отдаче: открытый дескриптор читает файл и после unlink.
        entry.file.cleanup().catch((e: unknown) => this.log.error({err: e, reason}, "prepared file cleanup failed"));
    }
}
