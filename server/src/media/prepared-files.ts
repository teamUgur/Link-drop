import {randomUUID} from "node:crypto";
import type {FastifyBaseLogger} from "fastify";
import type {DownloadedFile} from "./service.ts";

export type FileOwner = { session: string; ip: string };

type Entry = { file: DownloadedFile; timer: NodeJS.Timeout; owner: FileOwner };

// Готовые файлы между «подготовить» и «забрать». Зачем отдельный шаг: браузер скачивает обычной
// ссылкой (нативный прогресс, файл не копится в памяти вкладки), а ошибки и прогресс работы yt-dlp
// фронт получает через fetch — один GET-запрос не умеет ни того, ни другого.
//
// Id — случайный UUID: он и есть право на файл (как подписанная ссылка), угадать его нельзя.
// Хранится в памяти процесса: инстанс один, файлы и так лежат на его локальном диске; при второй
// реплике нужен sticky-роутинг по id или общее хранилище (S3).
export class PreparedFiles {
    private readonly entries = new Map<string, Entry>();
    // Один незабранный файл на сессию: новый заменяет старый — старый человек уже не заберёт,
    // раз запросил следующий. Сессию задаёт клиент (cookie), поэтому её одной мало: без cookie
    // каждый запрос — новая сессия, и клиент, готовя файлы и не забирая их, вытеснил бы потолком
    // чужие готовые файлы. Отсюда второй потолок — perIpLimit незабранных файлов на IP.
    private readonly bySession = new Map<string, string>();
    // Set хранит порядок вставки — первый id самый старый.
    private readonly byIp = new Map<string, Set<string>>();
    private readonly ttlMs: number;
    private readonly limit: number;
    private readonly perIpLimit: number;
    private readonly log: FastifyBaseLogger;

    constructor(ttlMs: number, limit: number, perIpLimit: number, log: FastifyBaseLogger) {
        this.ttlMs = ttlMs;
        this.limit = limit;
        this.perIpLimit = perIpLimit;
        this.log = log;
    }

    put(file: DownloadedFile, owner: FileOwner): string {
        const previous = this.bySession.get(owner.session);
        if (previous !== undefined) this.remove(previous, "replaced");
        const ipFiles = this.byIp.get(owner.ip);
        while (ipFiles && ipFiles.size >= this.perIpLimit) {
            const oldest = ipFiles.values().next().value;
            if (oldest === undefined) break;
            this.remove(oldest, "replaced");
        }
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
        this.entries.set(id, {file, timer, owner});
        this.bySession.set(owner.session, id);
        const set = this.byIp.get(owner.ip) ?? new Set<string>();
        set.add(id);
        this.byIp.set(owner.ip, set);
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
        this.bySession.clear();
        this.byIp.clear();
        await Promise.all(files.map((e) => e.file.cleanup()));
    }

    private remove(id: string, reason: string): void {
        const entry = this.entries.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.entries.delete(id);
        if (this.bySession.get(entry.owner.session) === id) this.bySession.delete(entry.owner.session);
        const ipFiles = this.byIp.get(entry.owner.ip);
        ipFiles?.delete(id);
        if (ipFiles?.size === 0) this.byIp.delete(entry.owner.ip);
        // Удаление каталога не мешает идущей отдаче: открытый дескриптор читает файл и после unlink.
        entry.file.cleanup().catch((e: unknown) => this.log.error({err: e, reason}, "prepared file cleanup failed"));
    }
}
