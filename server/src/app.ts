import rateLimit from "@fastify/rate-limit";
import Fastify, {type FastifyError, type FastifyInstance} from "fastify";
import {MaxClient, type FetchFn} from "./bots/max/client.ts";
import {maxBotRoutes} from "./bots/max/routes.ts";
import {MaxBotService} from "./bots/max/service.ts";
import type {Env} from "./env.ts";
import {AppError, BusyError, DownloadAbortedError, errorBody, InternalError, UpstreamError} from "./errors.ts";
import {PreparedFiles} from "./media/prepared-files.ts";
import {mediaRoutes} from "./media/routes.ts";
import {MediaService} from "./media/service.ts";
import {SpawnRunner, YtDlp, type ProcessRunner} from "./media/ytdlp.ts";
import {Semaphore} from "./shared/semaphore.ts";

export type AppDeps = {
    env: Env;
    runner?: ProcessRunner;
    maxFetch?: FetchFn;
    maxSleep?: (ms: number) => Promise<unknown>;
};

export type BuiltApp = { app: FastifyInstance; maxBot: MaxBotService | undefined };

export async function buildApp({env, runner, maxFetch, maxSleep}: AppDeps): Promise<BuiltApp> {
    const app = Fastify({
        logger: {
            level: env.LOG_LEVEL,
            // Полный URL скачивания содержит ссылку пользователя — в логе оставляем только путь.
            serializers: {req: (req) => ({method: req.method, url: req.url.split("?")[0], ip: req.ip})},
            redact: ["req.headers.authorization", `req.headers["x-max-bot-api-secret"]`],
        },
        trustProxy: env.TRUST_PROXY_HOPS > 0 ? (_address: string, hop: number) => hop < env.TRUST_PROXY_HOPS : false,
        bodyLimit: 64 * 1024,
        // Поток prepare живёт, пока работает yt-dlp, а это минуты: дефолтный requestTimeout
        // закрыл бы такой запрос. Таймаут скачивания держит DOWNLOAD_TIMEOUT_MS.
        requestTimeout: 0,
        return503OnClosing: true,
    });

    app.setErrorHandler((error: FastifyError | Error, request, reply) => {
        if (error instanceof DownloadAbortedError || reply.raw.destroyed) {
            request.log.info("client went away before response");
            return reply;
        }
        if (error instanceof AppError) {
            if (error instanceof BusyError) reply.header("Retry-After", String(error.retryAfterSec));
            if (error instanceof UpstreamError) request.log.warn({err: error}, "upstream failure");
            else if (error.statusCode >= 500) request.log.error({err: error}, error.message);
            return reply.status(error.statusCode).send(errorBody(error));
        }
        const status = (error as FastifyError).statusCode;
        // Ошибки самого Fastify (кривой JSON, тело больше лимита, не тот Content-Type) — клиентские.
        if (status !== undefined && status >= 400 && status < 500) {
            return reply.status(status).send({error: {code: "VALIDATION_ERROR", message: error.message}});
        }
        request.log.error({err: error}, "unhandled error");
        return reply.status(500).send(errorBody(new InternalError()));
    });

    app.setNotFoundHandler((_request, reply) => reply.status(404).send({error: {code: "NOT_FOUND", message: "Not found"}}));

    // Счётчики в памяти процесса: инстанс один, Redis ради этого — лишняя инфраструктура.
    // При второй реплике — передать redis в плагин, иначе лимит фактически умножится на число реплик.
    await app.register(rateLimit, {
        global: false,
        errorResponseBuilder: (_req, ctx) => new AppError("RATE_LIMITED", 429, `Слишком много запросов, повторите через ${Math.ceil(ctx.ttl / 1000)} с`),
    });

    const limiterRetryAfter = 30;
    const ytdlp = new YtDlp(runner ?? new SpawnRunner(env.YTDLP_PATH), {
        jsRuntime: env.YTDLP_JS_RUNTIME,
        cookiesFile: env.YTDLP_COOKIES_FILE,
        tempRoot: env.TEMP_DIR,
        resolveTimeoutMs: env.RESOLVE_TIMEOUT_MS,
        downloadTimeoutMs: env.DOWNLOAD_TIMEOUT_MS,
        maxDurationSec: env.MAX_DURATION_SEC,
        maxFileBytes: env.MAX_FILE_MB * 1024 * 1024,
    });
    const media = new MediaService({
        ytdlp,
        resolveLimiter: new Semaphore(env.RESOLVE_CONCURRENCY, env.QUEUE_LIMIT, limiterRetryAfter),
        downloadLimiter: new Semaphore(env.DOWNLOAD_CONCURRENCY, env.QUEUE_LIMIT, limiterRetryAfter),
        tempRoot: env.TEMP_DIR,
        maxDurationSec: env.MAX_DURATION_SEC,
    });

    const prepared = new PreparedFiles(env.PREPARED_FILE_TTL_SEC * 1000, env.PREPARED_FILES_LIMIT, app.log.child({module: "prepared-files"}));
    // onClose срабатывает после того, как Fastify дождался текущих запросов — идущие отдачи не рвём.
    app.addHook("onClose", () => prepared.clear());

    app.get("/api/health", async () => ({status: "ok"}));
    await app.register(mediaRoutes, {
        service: media,
        prepared,
        resolvePerMinute: env.RATE_LIMIT_RESOLVE_PER_MIN,
        downloadPerMinute: env.RATE_LIMIT_DOWNLOAD_PER_MIN,
    });

    if (env.MAX_BOT_TOKEN && env.MAX_WEBHOOK_SECRET) {
        const client = new MaxClient(env.MAX_API_URL, env.MAX_BOT_TOKEN, maxFetch, maxSleep);
        const bot = new MaxBotService(client, media, app.log.child({module: "max-bot"}));
        await app.register(maxBotRoutes, {service: bot, secret: env.MAX_WEBHOOK_SECRET});
        return {app, maxBot: bot};
    }
    app.log.info("MAX_BOT_TOKEN not set, MAX bot disabled");
    return {app, maxBot: undefined};
}
