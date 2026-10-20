import {spawn} from "node:child_process";
import {copyFile, readFile, stat} from "node:fs/promises";
import path from "node:path";
import {
    AppError,
    DownloadAbortedError,
    MediaUnavailableError,
    TooLargeError,
    UnsupportedSourceError,
    UpstreamError,
    UpstreamTimeoutError,
} from "../errors.ts";
import {createTempDir, dirSize} from "../shared/temp-dir.ts";
import {presetArgs, type Preset, type YtFormat} from "./presets.ts";
import {EXTRACTORS, type Source} from "./sources.ts";

export type RunOptions = {
    cwd: string;
    timeoutMs: number;
    signal?: AbortSignal;
    captureStdout: boolean;
    maxStdoutBytes?: number;
    // Вызывается периодически, пока процесс жив; бросает — процесс убивается с этой ошибкой.
    watchdog?: () => Promise<void>;
};

export type RunResult = { stdout: string; stderr: string };

export class YtDlpExitError extends Error {
    readonly exitCode: number | null;
    readonly stderr: string;

    constructor(exitCode: number | null, stderr: string) {
        super(`yt-dlp exited with code ${exitCode}: ${stderr.slice(-500)}`);
        this.name = "YtDlpExitError";
        this.exitCode = exitCode;
        this.stderr = stderr;
    }
}

// Шов для тестов: сервис зовёт yt-dlp только через этот интерфейс.
export interface ProcessRunner {
    run(args: string[], options: RunOptions): Promise<RunResult>;
}

const STDERR_TAIL_BYTES = 16 * 1024;
const KILL_GRACE_MS = 5_000;
// Раз в секунду: тот же тик отдаёт прогресс в браузер, реже — полоса загрузки «дёргается».
const WATCHDOG_INTERVAL_MS = 1_000;

// Окружение yt-dlp — по списку, а не всё process.env: yt-dlp и ffmpeg разбирают чужие страницы
// и файлы, а для YouTube yt-dlp исполняет в node JS плеера с сервера платформы. Токен бота и секрет
// webhook такому процессу не нужны. Прокси-переменные оставлены: с VPS, где платформа недоступна
// напрямую, yt-dlp ходит через HTTPS_PROXY без правки кода.
const CHILD_ENV_KEYS = [
    "PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "XDG_CACHE_HOME",
    "SSL_CERT_FILE", "SSL_CERT_DIR",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy",
];

export function childEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {PYTHONUNBUFFERED: "1"};
    for (const key of CHILD_ENV_KEYS) {
        if (source[key] !== undefined) env[key] = source[key];
    }
    return env;
}

export class SpawnRunner implements ProcessRunner {
    private readonly binary: string;

    constructor(binary: string) {
        this.binary = binary;
    }

    run(args: string[], options: RunOptions): Promise<RunResult> {
        return new Promise((resolve, reject) => {
            // Массив аргументов без shell — ссылка не может стать командой.
            // detached: своя группа процессов, чтобы убить и ffmpeg, которого запускает yt-dlp;
            // kill по одному pid оставлял бы ffmpeg сиротой, дописывающим файл.
            const child = spawn(this.binary, args, {
                cwd: options.cwd,
                detached: true,
                stdio: ["ignore", options.captureStdout ? "pipe" : "ignore", "pipe"],
                env: childEnv(process.env),
            });

            const stdoutChunks: Buffer[] = [];
            let stdoutBytes = 0;
            let stderr = "";
            let failure: Error | undefined;
            let settled = false;

            const killGroup = (signal: NodeJS.Signals) => {
                if (child.pid === undefined) return;
                try {
                    process.kill(-child.pid, signal);
                } catch (e) {
                    if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
                }
            };
            let killTimer: NodeJS.Timeout | undefined;
            const abort = (error: Error) => {
                if (failure) return;
                failure = error;
                killGroup("SIGTERM");
                killTimer = setTimeout(() => killGroup("SIGKILL"), KILL_GRACE_MS);
                killTimer.unref();
            };

            const timeout = setTimeout(() => abort(new UpstreamTimeoutError()), options.timeoutMs);
            const onAbort = () => abort(new DownloadAbortedError());
            options.signal?.addEventListener("abort", onAbort, {once: true});

            let watchdogBusy = false;
            const watchdog = options.watchdog && setInterval(() => {
                if (watchdogBusy) return;
                watchdogBusy = true;
                options.watchdog!().catch((e: Error) => abort(e)).finally(() => (watchdogBusy = false));
            }, WATCHDOG_INTERVAL_MS);

            child.stdout?.on("data", (chunk: Buffer) => {
                stdoutBytes += chunk.length;
                if (options.maxStdoutBytes !== undefined && stdoutBytes > options.maxStdoutBytes) {
                    abort(new UpstreamError({cause: new Error(`yt-dlp stdout exceeded ${options.maxStdoutBytes} bytes`)}));
                    return;
                }
                stdoutChunks.push(chunk);
            });
            child.stderr!.setEncoding("utf8");
            child.stderr!.on("data", (chunk: string) => {
                stderr = (stderr + chunk).slice(-STDERR_TAIL_BYTES);
            });

            const finish = (error: Error | undefined) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (watchdog) clearInterval(watchdog);
                options.signal?.removeEventListener("abort", onAbort);
                if (error) reject(error);
                else resolve({stdout: Buffer.concat(stdoutChunks).toString("utf8"), stderr});
            };

            child.on("error", (e) => finish(e));
            child.on("close", (code) => {
                if (killTimer) clearTimeout(killTimer);
                if (failure) finish(failure);
                else if (code !== 0) finish(new YtDlpExitError(code, stderr));
                else finish(undefined);
            });
        });
    }
}

export type MediaInfo = {
    id: string;
    title: string;
    durationSec: number | null;
    thumbnailUrl: string | null;
    isLive: boolean;
    formats: YtFormat[];
};

export type DownloadResult = { filePath: string; sizeBytes: number; title: string };

export type YtDlpConfig = {
    jsRuntime: string;
    cookiesFile: string | undefined;
    tempRoot: string;
    resolveTimeoutMs: number;
    downloadTimeoutMs: number;
    maxDurationSec: number;
    maxFileBytes: number;
};

// Ответ -J для YouTube с субтитрами бывает 5–10 МБ; потолок — защита от бесконечного вывода.
const MAX_PROBE_STDOUT = 64 * 1024 * 1024;
const FILTERED_MARKER = "does not pass filter";
const SINGLE_VIDEO_ONLY = "Это плейлист, канал или профиль — пришлите ссылку на одно видео";

export class YtDlp {
    private readonly runner: ProcessRunner;
    private readonly config: YtDlpConfig;

    constructor(runner: ProcessRunner, config: YtDlpConfig) {
        this.runner = runner;
        this.config = config;
    }

    async probe(url: string, source: Source, signal?: AbortSignal): Promise<MediaInfo> {
        const dir = await createTempDir(this.config.tempRoot);
        try {
            const args = [...(await this.baseArgs(source, dir.path)), "-J", "--", url];
            const {stdout} = await this.runner
                .run(args, {cwd: dir.path, timeoutMs: this.config.resolveTimeoutMs, signal, captureStdout: true, maxStdoutBytes: MAX_PROBE_STDOUT})
                .catch((e: unknown) => Promise.reject(translateError(e)));
            return parseInfo(stdout);
        } finally {
            await dir.remove();
        }
    }

    // Файл остаётся внутри dir. Удаляет dir вызывающий — файл ещё нужно отдать клиенту.
    async download(url: string, source: Source, preset: Preset, dir: string, signal?: AbortSignal, onProgress?: (downloadedBytes: number) => void): Promise<DownloadResult> {
        const ext = preset.kind === "audio" ? "mp3" : "mp4";
        const target = path.join(dir, `media.${ext}`);
        const titleFile = path.join(dir, "title.txt");
        const maxBytes = this.config.maxFileBytes;
        const args = [
            ...(await this.baseArgs(source, dir)),
            ...presetArgs(preset),
            // Те же потолки, что и в resolve: download можно вызвать напрямую, минуя resolve.
            "--match-filter", `!is_live & duration <=? ${this.config.maxDurationSec}`,
            "--max-filesize", String(maxBytes),
            "--no-mtime",
            // Без --quiet: по stdout отличаем «отсеяно фильтром» от поломки yt-dlp.
            "--no-progress",
            "--print-to-file", "%(title)s", titleFile,
            "-o", path.join(dir, "media.%(ext)s"),
            "--", url,
        ];
        // --max-filesize срабатывает только когда размер известен заранее (у HLS/DASH его нет),
        // поэтому дополнительно следим за диском и убиваем процесс на превышении.
        // Прогресс — тот же размер папки, а не разбор строк прогресса yt-dlp: формат вывода не контракт
        // и у видео+аудио это два отдельных счётчика, а байты на диске одинаковы для всех платформ.
        const watchdog = async () => {
            const size = await dirSize(dir);
            if (size > maxBytes) throw tooLarge(maxBytes);
            onProgress?.(size);
        };

        let result: RunResult;
        try {
            result = await this.runner.run(args, {cwd: dir, timeoutMs: this.config.downloadTimeoutMs, signal, captureStdout: true, maxStdoutBytes: 1024 * 1024, watchdog});
        } catch (e) {
            throw translateError(e);
        }

        const fileSize = await stat(target).then((s) => s.size, (e: NodeJS.ErrnoException) => {
            if (e.code === "ENOENT") return undefined;
            throw e;
        });
        if (fileSize === undefined) {
            const output = result.stdout + result.stderr;
            if (output.includes(FILTERED_MARKER)) {
                throw new TooLargeError(`Видео длиннее ${Math.round(this.config.maxDurationSec / 60)} минут или это прямой эфир`);
            }
            if (/larger than max-filesize/i.test(output)) throw tooLarge(maxBytes);
            throw new UpstreamError({cause: new Error(`yt-dlp finished without output file: ${output.slice(-500)}`)});
        }
        if (fileSize > maxBytes) throw tooLarge(maxBytes);
        // Название — только для имени файла; его отсутствие не повод ронять готовую загрузку.
        const title = await readFile(titleFile, "utf8").then((t) => t.split("\n")[0]!.trim(), (e: NodeJS.ErrnoException) => {
            if (e.code === "ENOENT") return "";
            throw e;
        });
        return {filePath: target, sizeBytes: fileSize, title: title || "video"};
    }

    private async baseArgs(source: Source, dir: string): Promise<string[]> {
        const args = [
            // Конфиг пользователя/системы не должен менять поведение сервера.
            "--ignore-config",
            "--no-playlist",
            "--use-extractors", EXTRACTORS[source],
            "--js-runtimes", this.config.jsRuntime,
            "--socket-timeout", "20",
            "--retries", "3",
            "--no-color",
        ];
        if (this.config.cookiesFile) {
            // yt-dlp перезаписывает cookie-файл в конце работы. Параллельные процессы на одном
            // файле портят его, поэтому каждый получает свою копию.
            const copy = path.join(dir, "cookies.txt");
            await copyFile(this.config.cookiesFile, copy);
            args.push("--cookies", copy);
        }
        return args;
    }
}

function tooLarge(maxBytes: number): TooLargeError {
    return new TooLargeError(`Файл больше ${Math.round(maxBytes / 1024 / 1024)} МБ`);
}

function parseInfo(stdout: string): MediaInfo {
    let raw: unknown;
    try {
        raw = JSON.parse(stdout);
    } catch (e) {
        throw new UpstreamError({cause: e});
    }
    if (typeof raw !== "object" || raw === null) throw new UpstreamError({cause: new Error("yt-dlp JSON is not an object")});
    const info = raw as Record<string, unknown>;
    if (info._type === "playlist") {
        throw new MediaUnavailableError(SINGLE_VIDEO_ONLY);
    }
    const formats = Array.isArray(info.formats) ? (info.formats as YtFormat[]) : [];
    // Instagram/TikTok иногда отдают единственный формат на верхнем уровне, без списка formats.
    if (formats.length === 0 && typeof info.format_id === "string") formats.push(info as unknown as YtFormat);

    return {
        id: String(info.id ?? ""),
        title: typeof info.title === "string" && info.title.trim() ? info.title : "Видео",
        durationSec: typeof info.duration === "number" ? Math.round(info.duration) : null,
        thumbnailUrl: typeof info.thumbnail === "string" ? info.thumbnail : null,
        isLive: info.is_live === true || info.live_status === "is_live" || info.live_status === "is_upcoming",
        formats,
    };
}

const UNAVAILABLE = [
    /private video/i, /this video is private/i, /video (?:is )?unavailable/i, /has been removed/i,
    /not available in your country/i, /geo.?restrict/i, /http error 404/i, /requested content is not available/i,
    /this post (?:may have been|has been) removed/i, /sign in to confirm your age/i, /age.?restricted/i,
    /login required/i, /no video (?:formats|in this post)/i, /account (?:has been )?terminated/i,
];

// Сообщения yt-dlp — не контракт, они меняются между версиями. Поэтому всё нераспознанное
// уходит в UPSTREAM_ERROR с полным stderr в логе, а не в «видео недоступно»: так поломку
// yt-dlp видно по метрике, а пользователь не получает ложное «видео удалено».
export function translateError(e: unknown): Error {
    if (e instanceof AppError || e instanceof DownloadAbortedError) return e;
    if (!(e instanceof YtDlpExitError)) return e instanceof Error ? e : new Error(String(e));
    const stderr = e.stderr;
    if (/unsupported url/i.test(stderr)) return new UnsupportedSourceError();
    // Хост наш, но экстрактор видео ссылку не взял — это канал, профиль или плейлист
    // (их экстракторы мы намеренно не включаем в --use-extractors).
    if (/no suitable extractor/i.test(stderr)) return new MediaUnavailableError(SINGLE_VIDEO_ONLY, {cause: e});
    if (/larger than max-filesize/i.test(stderr)) return new TooLargeError("Файл слишком большой");
    if (/confirm you.?re not a bot/i.test(stderr)) return new UpstreamError({cause: e});
    if (UNAVAILABLE.some((r) => r.test(stderr))) return new MediaUnavailableError(undefined, {cause: e});
    return new UpstreamError({cause: e});
}
