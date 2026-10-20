import {randomUUID} from "node:crypto";
import {createReadStream} from "node:fs";
import type {OutgoingHttpHeaders} from "node:http";
import {normalizeIP} from "@fastify/rate-limit";
import {PassThrough} from "node:stream";
import type {FastifyBaseLogger, FastifyPluginAsync, FastifyReply, FastifyRequest} from "fastify";
import {AppError, DownloadAbortedError, DownloadInProgressError, errorBody, FileExpiredError, InternalError, NetworkDownloadsLimitError, UpstreamError, type ErrorBody} from "../errors.ts";
import {clientGoneSignal, contentDisposition, parse} from "../shared/http.ts";
import {KeyedLimit} from "../shared/keyed-limit.ts";
import type {FileOwner, PreparedFiles} from "./prepared-files.ts";
import {fileParamsSchema, prepareBodySchema, resolveBodySchema} from "./schemas.ts";
import type {MediaService} from "./service.ts";

export type MediaRoutesOptions = {
    service: MediaService;
    prepared: PreparedFiles;
    resolvePerMinute: number;
    downloadPerMinute: number;
    downloadsPerIp: number;
};

const SESSION_COOKIE = "ld_sid";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Сессия — не авторизация, а только ключ «этот браузер»: подписывать cookie незачем, подделанный
// или чужой id даёт не больше, чем свежий (лимит IP всё равно действует). Cookie выдаём сами,
// а не id из localStorage во фронте: тот же эффект, но фронту ничего не нужно знать.
// Без Max-Age — живёт до закрытия браузера; функциональная cookie, баннер согласия не нужен.
function sessionOf(request: FastifyRequest, reply: FastifyReply): string {
    const current = request.cookies[SESSION_COOKIE];
    if (current && UUID.test(current)) return current;
    const id = randomUUID();
    reply.setCookie(SESSION_COOKIE, id, {
        path: "/api/media",
        httpOnly: true,
        sameSite: "lax",
        // За Caddy протокол берётся из X-Forwarded-Proto (trustProxy); на локальном http-стенде
        // Secure-cookie браузер бы не сохранил.
        secure: request.protocol === "https",
    });
    return id;
}

// Строки NDJSON в ответе prepare. Последняя строка — всегда ready или error.
export type PrepareEvent =
    | { type: "started" }
    | { type: "progress"; downloadedBytes: number }
    | { type: "ready"; fileUrl: string; fileName: string; sizeBytes: number }
    | ({ type: "error" } & ErrorBody);

export const mediaRoutes: FastifyPluginAsync<MediaRoutesOptions> = async (app, opts) => {
    // Две границы на подготовку файла. Rate limit считает запросы, а не занятое время: 6 часовых
    // видео в минуту с одного адреса заняли бы все слоты и очередь на 10 минут.
    // - браузер (cookie сессии) — одна загрузка: обычный человек больше и не делает;
    // - IP — downloadsPerIp: cookie атакующий не пошлёт, каждый его запрос — новая сессия, так что
    //   защищает именно этот потолок. Ключ — тот же, что у rate limit: IPv6 сворачивается в подсеть,
    //   иначе адрес из своей /64 меняется на каждый запрос.
    // Цена: за мобильным CGNAT тысячи людей делят IP и упрутся в потолок. Лечится только
    // аккаунтами или капчей — пока не нужно.
    const activeBySession = new KeyedLimit(1);
    const activeByIp = new KeyedLimit(opts.downloadsPerIp);

    function acquireDownload(owner: FileOwner): () => void {
        const releaseSession = activeBySession.tryAcquire(owner.session);
        if (!releaseSession) throw new DownloadInProgressError();
        const releaseIp = activeByIp.tryAcquire(owner.ip);
        if (!releaseIp) {
            releaseSession();
            throw new NetworkDownloadsLimitError();
        }
        return () => {
            releaseSession();
            releaseIp();
        };
    }

    app.post("/api/media/resolve", {config: {rateLimit: {max: opts.resolvePerMinute, timeWindow: "1 minute"}}}, async (request, reply) => {
        const {url} = parse(resolveBodySchema, request.body);
        return opts.service.resolve(url, clientGoneSignal(reply));
    });

    // Подготовка файла: yt-dlp качает на наш диск, клиент видит прогресс потоком NDJSON и в конце
    // получает одноразовую ссылку. NDJSON поверх fetch, а не SSE: EventSource умеет только GET без тела,
    // а обрыв fetch (AbortController) сразу убивает yt-dlp через clientGoneSignal.
    app.post("/api/media/prepare", {config: {rateLimit: {max: opts.downloadPerMinute, timeWindow: "1 minute"}}}, async (request, reply) => {
        const {url, format} = parse(prepareBodySchema, request.body);
        const owner: FileOwner = {session: sessionOf(request, reply), ip: normalizeIP(request.ip)};
        const release = acquireDownload(owner);
        const signal = clientGoneSignal(reply);
        const events = new PassThrough();
        const emit = (event: PrepareEvent) => {
            if (!events.writableEnded && !events.destroyed) events.write(JSON.stringify(event) + "\n");
        };

        let markStarted!: () => void;
        const started = new Promise<void>((resolve) => (markStarted = resolve));
        // Блокировка держится, пока работает yt-dlp (или ждёт слота), а не до отдачи файла:
        // отдача — дешёвый поток с диска, а незабранные файлы ограничивает PreparedFiles.
        const download = opts.service.download(url, format, {
            signal,
            onStarted: () => markStarted(),
            onProgress: (downloadedBytes) => emit({type: "progress", downloadedBytes}),
        });
        download.then(release, release);
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
                const id = opts.prepared.put(file, owner);
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

        reply
            .header("Content-Type", file.contentType)
            .header("Content-Length", String(file.sizeBytes))
            .header("Content-Disposition", contentDisposition(file.fileName))
            .header("Cache-Control", "no-store")
            .header("X-Content-Type-Options", "nosniff");

        // Fastify сам вешает HEAD на этот GET. HEAD шлют менеджеры загрузок, превью ссылок и антивирусы
        // перед настоящим GET — его 'finish' не значит «файл забран», иначе GET следом получал 404.
        // Ответ пишем мимо Fastify: поток на HEAD он вычитывает с диска целиком (до MAX_FILE_MB впустую),
        // а на пустое тело ставит Content-Length: 0 — клиент решил бы, что файл пустой.
        if (request.method === "HEAD") {
            reply.hijack();
            reply.raw.writeHead(200, reply.getHeaders() as OutgoingHttpHeaders);
            reply.raw.end();
            return reply;
        }

        // Удаляем только после полной отдачи ('finish', а не 'close': close приходит и при обрыве):
        // оборванную загрузку можно повторить, пока не истёк TTL.
        reply.raw.once("finish", () => opts.prepared.complete(id));
        return reply.send(createReadStream(file.filePath));
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
