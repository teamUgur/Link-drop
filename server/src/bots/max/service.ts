import type {FastifyBaseLogger} from "fastify";
import {AppError, BusyError} from "../../errors.ts";
import type {MediaService} from "../../media/service.ts";
import type {Semaphore} from "../../shared/semaphore.ts";
import {detectSource, findUrl} from "../../media/sources.ts";
import type {MaxClient, Recipient, UploadType} from "./client.ts";
import type {MaxUpdate} from "./schemas.ts";

// Лимит MAX на видео-вложение. Больше — отправляем документом (до 4 ГБ), а не отказываем.
const VIDEO_ATTACHMENT_MAX_BYTES = 250 * 1024 * 1024;
const DEDUP_CAPACITY = 10_000;

const TEXT = {
    greeting: "Привет! Пришлите ссылку на видео из YouTube, Instagram или TikTok — я верну файл.",
    noUrl: "Не вижу ссылки. Пришлите ссылку на видео из YouTube, Instagram или TikTok.",
    working: "Скачиваю видео, это может занять до пары минут…",
    oneAtATime: "Предыдущее видео ещё скачивается — дождитесь его, пожалуйста.",
    failed: "Не получилось скачать видео. Попробуйте ещё раз позже.",
};

export class MaxBotService {
    private readonly client: MaxClient;
    private readonly media: MediaService;
    private readonly limiter: Semaphore;
    private readonly log: FastifyBaseLogger;
    private readonly tasks = new Set<Promise<void>>();
    // In-memory, потому что инстанс один. MAX повторяет доставку, если не получил 200 за 30 с;
    // мы отвечаем сразу, но повтор после сетевого сбоя всё равно возможен — без дедупликации
    // человек получил бы видео дважды. При нескольких репликах — перенести в Redis (SET NX EX).
    private readonly seen = new Map<string, true>();
    private readonly activeUsers = new Set<number>();

    constructor(client: MaxClient, media: MediaService, limiter: Semaphore, log: FastifyBaseLogger) {
        this.client = client;
        this.media = media;
        this.limiter = limiter;
        this.log = log;
    }

    // Не ждём обработку: webhook обязан ответить за 30 с, а загрузка видео дольше.
    enqueue(update: MaxUpdate): void {
        const task = this.handle(update)
            .catch((e: unknown) => this.log.error({err: e, updateType: update.update_type}, "max update failed"))
            .finally(() => this.tasks.delete(task));
        this.tasks.add(task);
    }

    // Для graceful shutdown: дождаться начатых загрузок, чтобы не бросить человека без ответа.
    async drain(): Promise<void> {
        await Promise.allSettled([...this.tasks]);
    }

    get pendingCount(): number {
        return this.tasks.size;
    }

    private async handle(update: MaxUpdate): Promise<void> {
        if (update.update_type === "bot_started") {
            const to = update.chat_id !== undefined ? {chatId: update.chat_id} : update.user ? {userId: update.user.user_id} : undefined;
            if (to) await this.client.sendMessage(to, {text: TEXT.greeting});
            return;
        }
        if (update.update_type !== "message_created" || !update.message) return;

        const message = update.message;
        if (message.sender?.is_bot) return;
        if (!this.markSeen(message.body.mid)) return;

        const to: Recipient | undefined = message.recipient.chat_id != null
            ? {chatId: message.recipient.chat_id}
            : message.sender ? {userId: message.sender.user_id} : undefined;
        if (!to) return;

        const text = message.body.text ?? "";
        if (/^\/start\b/.test(text.trim())) {
            await this.client.sendMessage(to, {text: TEXT.greeting});
            return;
        }
        const url = findUrl(text);
        if (!url) {
            await this.client.sendMessage(to, {text: TEXT.noUrl});
            return;
        }

        const userId = message.sender?.user_id;
        if (userId !== undefined) {
            // Одна загрузка на человека: иначе один пользователь пачкой ссылок занимает все слоты.
            if (this.activeUsers.has(userId)) {
                await this.client.sendMessage(to, {text: TEXT.oneAtATime});
                return;
            }
            this.activeUsers.add(userId);
        }
        try {
            await this.deliver(to, url);
        } finally {
            if (userId !== undefined) this.activeUsers.delete(userId);
        }
    }

    private async deliver(to: Recipient, url: string): Promise<void> {
        try {
            detectSource(url);
            await this.client.sendMessage(to, {text: TEXT.working});
            // Слот бота держим только на время yt-dlp: отправка в MAX не занимает загрузчик.
            const file = await this.limiter.run(() => this.media.download(url, "mp4-720"));
            try {
                const type: UploadType = file.sizeBytes <= VIDEO_ATTACHMENT_MAX_BYTES ? "video" : "file";
                const token = await this.client.upload(type, file.filePath, file.fileName, file.contentType);
                await this.client.sendMessage(to, {attachments: [{type, payload: {token}}]});
            } finally {
                await file.cleanup();
            }
        } catch (e) {
            if (e instanceof AppError) {
                // Без ссылки в логе: что человек качает — его данные; сайт их тоже не пишет (app.ts).
                if (!(e instanceof BusyError) && e.statusCode >= 500) this.log.warn({err: e}, "max bot download failed");
                await this.client.sendMessage(to, {text: e.message});
                return;
            }
            this.log.error({err: e}, "max bot delivery failed");
            await this.client.sendMessage(to, {text: TEXT.failed});
        }
    }

    private markSeen(mid: string): boolean {
        if (this.seen.has(mid)) return false;
        this.seen.set(mid, true);
        if (this.seen.size > DEDUP_CAPACITY) {
            // Map хранит порядок вставки — первый ключ самый старый.
            const oldest = this.seen.keys().next().value;
            if (oldest !== undefined) this.seen.delete(oldest);
        }
        return true;
    }
}
