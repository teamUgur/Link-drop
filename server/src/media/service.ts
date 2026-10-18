import {MediaUnavailableError, TooLargeError} from "../errors.ts";
import type {Semaphore} from "../shared/semaphore.ts";
import {createTempDir} from "../shared/temp-dir.ts";
import {availableFormats, getPreset, type FormatOption, type PresetId} from "./presets.ts";
import {detectSource, type Source} from "./sources.ts";
import type {YtDlp} from "./ytdlp.ts";

export type ResolveResult = {
    source: Source;
    title: string;
    durationSec: number | null;
    thumbnailUrl: string | null;
    formats: FormatOption[];
};

export type DownloadedFile = {
    filePath: string;
    sizeBytes: number;
    fileName: string;
    contentType: string;
    // Удаляет временную папку. Вызывать, когда файл отдан или отдача оборвалась.
    cleanup: () => Promise<void>;
};

export type DownloadHooks = {
    signal?: AbortSignal;
    // Слот получен, yt-dlp запускается: до этого запрос стоит в очереди семафора.
    onStarted?: () => void;
    onProgress?: (downloadedBytes: number) => void;
};

export type MediaServiceDeps = {
    ytdlp: YtDlp;
    resolveLimiter: Semaphore;
    downloadLimiter: Semaphore;
    tempRoot: string;
    maxDurationSec: number;
};

export class MediaService {
    private readonly deps: MediaServiceDeps;

    constructor(deps: MediaServiceDeps) {
        this.deps = deps;
    }

    async resolve(rawUrl: string, signal?: AbortSignal): Promise<ResolveResult> {
        const {source, url} = detectSource(rawUrl);
        const info = await this.deps.resolveLimiter.run(() => this.deps.ytdlp.probe(url, source, signal), signal);

        if (info.isLive) throw new MediaUnavailableError("Прямые эфиры не поддерживаются");
        if (info.durationSec !== null && info.durationSec > this.deps.maxDurationSec) {
            throw new TooLargeError(`Видео длиннее ${Math.round(this.deps.maxDurationSec / 60)} минут`);
        }
        const formats = availableFormats(info.formats);
        if (formats.length === 0) throw new MediaUnavailableError("У видео нет доступных для скачивания форматов");

        return {source, title: info.title, durationSec: info.durationSec, thumbnailUrl: info.thumbnailUrl, formats};
    }

    async download(rawUrl: string, presetId: PresetId, {signal, onStarted, onProgress}: DownloadHooks = {}): Promise<DownloadedFile> {
        const {source, url} = detectSource(rawUrl);
        const preset = getPreset(presetId);

        // Слот держим только на время работы yt-dlp: отдача готового файла — дешёвый поток с диска,
        // и медленный клиент не должен блокировать загрузки остальных.
        const release = await this.deps.downloadLimiter.acquire(signal);
        let dir;
        try {
            dir = await createTempDir(this.deps.tempRoot);
            onStarted?.();
            const result = await this.deps.ytdlp.download(url, source, preset, dir.path, signal, onProgress);
            const ext = preset.kind === "audio" ? "mp3" : "mp4";
            return {
                filePath: result.filePath,
                sizeBytes: result.sizeBytes,
                fileName: `${safeFileName(result.title)}.${ext}`,
                contentType: preset.kind === "audio" ? "audio/mpeg" : "video/mp4",
                cleanup: dir.remove,
            };
        } catch (e) {
            await dir?.remove();
            throw e;
        } finally {
            release();
        }
    }
}

const MAX_NAME_LENGTH = 120;

export function safeFileName(title: string): string {
    const cleaned = title
        .normalize("NFC")
        .replace(/[\p{Cc}\p{Cf}]/gu, "")
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\s+/g, " ")
        .replace(/^[\s.]+|[\s.]+$/g, "");
    // Режем по кодовым точкам, а не по UTF-16: иначе эмодзи на границе превращается в мусор.
    const name = Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join("").trim();
    return name || "video";
}
