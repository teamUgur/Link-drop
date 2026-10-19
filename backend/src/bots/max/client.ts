import {openAsBlob} from "node:fs";
import {setTimeout as sleep} from "node:timers/promises";

export type UploadType = "video" | "audio" | "file";

export type Recipient = { chatId: number } | { userId: number };

export type AttachmentRequest = { type: UploadType; payload: { token: string } };

export type NewMessage = { text?: string; attachments?: AttachmentRequest[]; format?: "markdown" | "html" };

export class MaxApiError extends Error {
    readonly status: number;
    readonly code: string | undefined;

    constructor(status: number, code: string | undefined, message: string, options?: ErrorOptions) {
        super(`MAX API ${status} ${code ?? ""}: ${message}`, options);
        this.name = "MaxApiError";
        this.status = status;
        this.code = code;
    }
}

const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 10 * 60_000;
// MAX обрабатывает загруженное видео асинхронно и до готовности отвечает attachment.not.ready.
// Документация советует повторять с растущим интервалом; 1+2+4+8+16+30+30 ≈ 1,5 мин хватает
// на файлы в сотни МБ, дальше человеку проще получить сообщение об ошибке.
const NOT_READY_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
const RATE_LIMIT_BACKOFF_MS = [1_000, 3_000, 10_000];

export type FetchFn = typeof fetch;

export class MaxClient {
    private readonly baseUrl: string;
    private readonly token: string;
    private readonly fetchFn: FetchFn;
    private readonly sleepFn: (ms: number) => Promise<unknown>;

    constructor(baseUrl: string, token: string, fetchFn: FetchFn = fetch, sleepFn: (ms: number) => Promise<unknown> = sleep) {
        this.baseUrl = baseUrl.replace(/\/$/, "");
        this.token = token;
        this.fetchFn = fetchFn;
        this.sleepFn = sleepFn;
    }

    async sendMessage(to: Recipient, message: NewMessage): Promise<void> {
        const query = "chatId" in to ? `chat_id=${to.chatId}` : `user_id=${to.userId}`;
        let notReadyAttempt = 0;
        let rateLimitAttempt = 0;
        for (;;) {
            try {
                await this.request("POST", `/messages?${query}`, message);
                return;
            } catch (e) {
                if (!(e instanceof MaxApiError)) throw e;
                const delay = e.code === "attachment.not.ready"
                    ? NOT_READY_BACKOFF_MS[notReadyAttempt++]
                    : e.status === 429 ? RATE_LIMIT_BACKOFF_MS[rateLimitAttempt++] : undefined;
                if (delay === undefined) throw e;
                await this.sleepFn(delay);
            }
        }
    }

    // Файл уходит потоком с диска (openAsBlob), а не читается в память: видео до 250 МБ
    // на каждый параллельный запрос съели бы память процесса.
    async upload(type: UploadType, filePath: string, fileName: string, contentType: string): Promise<string> {
        const endpoint = await this.request<{ url?: string; token?: string }>("POST", `/uploads?type=${type}`);
        if (!endpoint.url) throw new MaxApiError(200, undefined, "uploads response has no url");

        const form = new FormData();
        form.append("data", await openAsBlob(filePath, {type: contentType}), fileName);
        const response = await this.fetchFn(endpoint.url, {
            method: "POST",
            headers: {Authorization: this.token},
            body: form,
            signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
        });
        const text = await response.text();
        if (!response.ok) throw new MaxApiError(response.status, undefined, text.slice(0, 500));

        // Для video/audio токен приходит ещё в ответе /uploads, для file — в ответе самой загрузки.
        if (endpoint.token) return endpoint.token;
        let uploaded: { token?: unknown };
        try {
            uploaded = JSON.parse(text) as { token?: unknown };
        } catch (e) {
            throw new MaxApiError(response.status, undefined, `upload response is not JSON: ${text.slice(0, 200)}`, {cause: e});
        }
        if (typeof uploaded.token !== "string") throw new MaxApiError(response.status, undefined, "upload response has no token");
        return uploaded.token;
    }

    async subscribe(url: string, secret: string, updateTypes: string[]): Promise<unknown> {
        return this.request("POST", "/subscriptions", {url, secret, update_types: updateTypes});
    }

    private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
        const response = await this.fetchFn(this.baseUrl + path, {
            method,
            // Токен только в заголовке: query-параметр access_token MAX больше не принимает,
            // а в URL он ещё и попал бы в логи прокси.
            headers: {Authorization: this.token, ...(body === undefined ? {} : {"Content-Type": "application/json"})},
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const text = await response.text();
        let json: unknown = undefined;
        if (text) {
            try {
                json = JSON.parse(text);
            } catch {
                // Не-JSON бывает на 5xx от балансировщика MAX: текст уйдёт в сообщение ошибки ниже.
                json = undefined;
            }
        }
        if (!response.ok) {
            const err = (json ?? {}) as { code?: string; message?: string };
            throw new MaxApiError(response.status, err.code, err.message ?? text.slice(0, 500));
        }
        return json as T;
    }
}
