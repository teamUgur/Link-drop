import {createReadStream} from "node:fs";
import {PassThrough} from "node:stream";
import type {FastifyBaseLogger, FastifyPluginAsync} from "fastify";
import {AppError, DownloadAbortedError, errorBody, FileExpiredError, InternalError, UpstreamError, type ErrorBody} from "../errors.ts";
import {clientGoneSignal, contentDisposition, parse} from "../shared/http.ts";
import type {PreparedFiles} from "./prepared-files.ts";
import {fileParamsSchema, prepareBodySchema, resolveBodySchema} from "./schemas.ts";
import type {MediaService} from "./service.ts";

export type MediaRoutesOptions = {
    service: MediaService;
    prepared: PreparedFiles;
    resolvePerMinute: number;
    downloadPerMinute: number;
};

// Строки NDJSON в ответе prepare. Последняя строка — всегда ready или error.
export type PrepareEvent =
    | { type: "started" }
    | { type: "progress"; downloadedBytes: number }
    | { type: "ready"; fileUrl: string; fileName: string; sizeBytes: number }
    | ({ type: "error" } & ErrorBody);

export const mediaRoutes: FastifyPluginAsync<MediaRoutesOptions> = async (app, opts) => {
    app.post("/api/media/resolve", {config: {rateLimit: {max: opts.resolvePerMinute, timeWindow: "1 minute"}}}, async (request, reply) => {
        const {url} = parse(resolveBodySchema, request.body);
        return opts.service.resolve(url, clientGoneSignal(reply));
    });

    // Подготовка файла: yt-dlp качает на наш диск, клиент видит прогресс потоком NDJSON и в конце
    // получает одноразовую ссылку. NDJSON поверх fetch, а не SSE: EventSource умеет только GET без тела,
    // а обрыв fetch (AbortController) сразу убивает yt-dlp через clientGoneSignal.
    app.post("/api/media/prepare", {config: {rateLimit: {max: opts.downloadPerMinute, timeWindow: "1 minute"}}}, async (request, reply) => {
        const {url, format} = parse(prepareBodySchema, request.body);
        const signal = clientGoneSignal(reply);
        const events = new PassThrough();
        const emit = (event: PrepareEvent) => {
            if (!events.writableEnded && !events.destroyed) events.write(JSON.stringify(event) + "\n");
        };

        let markStarted!: () => void;
        const started = new Promise<void>((resolve) => (markStarted = resolve));
        const download = opts.service.download(url, format, {
            signal,
            onStarted: () => markStarted(),
            onProgress: (downloadedBytes) => emit({type: "progress", downloadedBytes}),
        });
        // До старта yt-dlp ошибки (очередь полна, не та ссылка, клиент ушёл из очереди) уходят обычным
        // ответом с HTTP-статусом — так их понимает любой клиент. После старта заголовки 200 уже
        // отправлены, и ошибка становится последней строкой потока.
        await Promise.race([started, download]);
        emit({type: "started"});

        download.then(
            (file) => {
                if (signal.aborted) {
                    file.cleanup().catch((e: unknown) => request.log.error({err: e}, "temp dir cleanup failed"));
                    return;
                }
                const id = opts.prepared.put(file);
                emit({type: "ready", fileUrl: `/api/media/files/${id}`, fileName: file.fileName, sizeBytes: file.sizeBytes});
            },
            (e: unknown) => {
                if (e instanceof DownloadAbortedError) {
                    request.log.info("client went away during prepare");
                    return;
                }
                emit({type: "error", ...errorBody(toAppError(e, request.log))});
            },
        ).finally(() => events.end());

        return reply
            .header("Content-Type", "application/x-ndjson; charset=utf-8")
            .header("Cache-Control", "no-store")
            // Подсказка прокси не буферизовать поток: иначе прогресс приходит одним куском в конце.
            .header("X-Accel-Buffering", "no")
            .send(events);
    });

    // GET, а не fetch + Blob на фронте: браузер качает обычной ссылкой, сам показывает прогресс
    // и не держит сотни мегабайт в памяти вкладки.
    app.get("/api/media/files/:id", async (request, reply) => {
        const {id} = parse(fileParamsSchema, request.params);
        const file = opts.prepared.get(id);
        if (!file) throw new FileExpiredError();

        // Удаляем только после полной отдачи ('finish', а не 'close': close приходит и при обрыве):
        // оборванную загрузку можно повторить, пока не истёк TTL.
        reply.raw.once("finish", () => opts.prepared.complete(id));

        return reply
            .header("Content-Type", file.contentType)
            .header("Content-Length", String(file.sizeBytes))
            .header("Content-Disposition", contentDisposition(file.fileName))
            .header("Cache-Control", "no-store")
            .header("X-Content-Type-Options", "nosniff")
            .send(createReadStream(file.filePath));
    });
};

// Повторяет политику логирования общего обработчика ошибок в app.ts: туда ошибка из потока уже не попадёт.
function toAppError(e: unknown, log: FastifyBaseLogger): AppError {
    if (e instanceof AppError) {
        if (e instanceof UpstreamError) log.warn({err: e}, "upstream failure");
        else if (e.statusCode >= 500) log.error({err: e}, e.message);
        return e;
    }
    log.error({err: e}, "unhandled error during prepare");
    return new InternalError();
}
