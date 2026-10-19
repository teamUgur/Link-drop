import {FormatUnavailableError} from "../errors.ts";

export type PresetId = "mp4-1080" | "mp4-720" | "mp4-480" | "mp3";

type VideoPreset = { id: PresetId; kind: "video"; type: "MP4"; quality: string; maxShortSide: number; minShortSide: number };
type AudioPreset = { id: PresetId; kind: "audio"; type: "MP3"; quality: string; detail: string };
export type Preset = VideoPreset | AudioPreset;

// Высота считается по короткой стороне: у вертикального TikTok 1080×1920 «1080p», а не 1920p.
// yt-dlp в -S res делает так же (res = меньшее измерение), поэтому оценка и реальная загрузка совпадают.
// minShortSide — нижняя граница пресета: 1080p не показываем, если у видео нет ничего выше 720p,
// иначе три кнопки скачали бы один и тот же файл.
export const PRESETS: readonly Preset[] = [
    {id: "mp4-1080", kind: "video", type: "MP4", quality: "1080p", maxShortSide: 1080, minShortSide: 721},
    {id: "mp4-720", kind: "video", type: "MP4", quality: "720p", maxShortSide: 720, minShortSide: 481},
    {id: "mp4-480", kind: "video", type: "MP4", quality: "480p", maxShortSide: 480, minShortSide: 0},
    {id: "mp3", kind: "audio", type: "MP3", quality: "Audio", detail: "High quality"},
];

export const PRESET_IDS = PRESETS.map((p) => p.id) as [PresetId, ...PresetId[]];

export function getPreset(id: PresetId): Preset {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) throw new FormatUnavailableError();
    return preset;
}

// Строка формата собирается только здесь из нашего списка: клиент выбирает id пресета,
// а не передаёт -f, иначе он мог бы попросить, например, 8K-поток на гигабайты.
export function presetArgs(preset: Preset): string[] {
    if (preset.kind === "audio") {
        return ["-f", "ba/b", "-x", "--audio-format", "mp3", "--audio-quality", "0"];
    }
    return [
        "-f", "bv*+ba/b",
        // h264+aac — чтобы mp4 открывался везде, включая QuickTime и iOS; vp9/av1 в mp4 они не играют.
        "-S", `res:${preset.maxShortSide},vcodec:h264,acodec:aac,ext:mp4:m4a`,
        "--merge-output-format", "mp4",
        "--remux-video", "mp4",
    ];
}

export type YtFormat = {
    format_id: string;
    ext?: string | null;
    vcodec?: string | null;
    acodec?: string | null;
    width?: number | null;
    height?: number | null;
    filesize?: number | null;
    filesize_approx?: number | null;
    tbr?: number | null;
    abr?: number | null;
    protocol?: string | null;
};

export type FormatOption = {
    id: PresetId;
    type: "MP4" | "MP3";
    quality: string;
    detail: string;
    sizeBytes: number | null;
};

function isUsable(f: YtFormat): boolean {
    // Раскадровки (mhtml, sb*) и DRC-дорожки YouTube — не то, что человек хочет скачать.
    return f.ext !== "mhtml" && !f.format_id.startsWith("sb") && !f.format_id.endsWith("-drc");
}

function isVideo(f: YtFormat): boolean {
    return f.vcodec ? f.vcodec !== "none" : f.height != null;
}

function hasAudio(f: YtFormat): boolean {
    // У Instagram/TikTok кодеки часто не указаны вовсе — такой поток обычно со звуком.
    return f.acodec ? f.acodec !== "none" : true;
}

function shortSide(f: YtFormat): number {
    if (f.width && f.height) return Math.min(f.width, f.height);
    return f.height ?? 0;
}

function size(f: YtFormat): number | null {
    return f.filesize ?? f.filesize_approx ?? null;
}

function compareVideo(a: YtFormat, b: YtFormat): number {
    return (
        shortSide(b) - shortSide(a) ||
        Number(b.vcodec?.startsWith("avc1") ?? false) - Number(a.vcodec?.startsWith("avc1") ?? false) ||
        Number(size(b) != null) - Number(size(a) != null) ||
        (b.tbr ?? 0) - (a.tbr ?? 0)
    );
}

function compareAudio(a: YtFormat, b: YtFormat): number {
    return (
        Number(b.acodec?.startsWith("mp4a") ?? false) - Number(a.acodec?.startsWith("mp4a") ?? false) ||
        (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0)
    );
}

// Оценка для карточки, а не точный выбор: финальный формат выбирает yt-dlp по presetArgs.
// Сортировка повторяет его приоритеты (res → h264 → aac), поэтому разрешение совпадает, а размер — приблизительный.
export function availableFormats(formats: readonly YtFormat[]): FormatOption[] {
    const usable = formats.filter(isUsable);
    const videos = usable.filter(isVideo);
    const audios = usable.filter((f) => !isVideo(f) && hasAudio(f)).sort(compareAudio);
    const bestAudio = audios[0];
    const result: FormatOption[] = [];

    for (const preset of PRESETS) {
        if (preset.kind === "audio") {
            if (bestAudio || videos.some(hasAudio)) {
                result.push({id: preset.id, type: preset.type, quality: preset.quality, detail: preset.detail, sizeBytes: null});
            }
            continue;
        }
        const best = videos.filter((f) => shortSide(f) <= preset.maxShortSide).sort(compareVideo)[0];
        if (!best || shortSide(best) < preset.minShortSide) continue;

        let sizeBytes = size(best);
        if (!hasAudio(best)) {
            const audioSize = bestAudio ? size(bestAudio) : null;
            sizeBytes = sizeBytes != null && audioSize != null ? sizeBytes + audioSize : null;
        }
        const detail = best.width && best.height ? `${best.width} × ${best.height}` : `${shortSide(best)}p`;
        result.push({id: preset.id, type: preset.type, quality: preset.quality, detail, sizeBytes});
    }
    return result;
}
