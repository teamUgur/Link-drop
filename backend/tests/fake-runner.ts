import {writeFile} from "node:fs/promises";
import path from "node:path";
import {loadEnv, type Env} from "../src/env.ts";
import type {ProcessRunner, RunOptions, RunResult} from "../src/media/ytdlp.ts";

export const YT_INFO = {
    id: "abc",
    title: "Тест / видео: \"кавычки\"",
    duration: 120,
    thumbnail: "https://i.ytimg.com/vi/abc/hq.jpg",
    formats: [
        {format_id: "sb0", ext: "mhtml", vcodec: "none", acodec: "none"},
        {format_id: "140", ext: "m4a", vcodec: "none", acodec: "mp4a.40.2", filesize: 2_000_000, abr: 128},
        {format_id: "251", ext: "webm", vcodec: "none", acodec: "opus", filesize: 1_900_000, abr: 130},
        {format_id: "140-drc", ext: "m4a", vcodec: "none", acodec: "mp4a.40.2", filesize: 2_000_000, abr: 129},
        {format_id: "137", ext: "mp4", vcodec: "avc1.640028", acodec: "none", width: 1920, height: 1080, filesize: 50_000_000, tbr: 4000},
        {format_id: "248", ext: "webm", vcodec: "vp9", acodec: "none", width: 1920, height: 1080, filesize: 40_000_000, tbr: 3000},
        {format_id: "136", ext: "mp4", vcodec: "avc1.4d401f", acodec: "none", width: 1280, height: 720, filesize: 20_000_000, tbr: 2000},
        {format_id: "135", ext: "mp4", vcodec: "avc1.4d401e", acodec: "none", width: 854, height: 480, filesize_approx: 9_000_000, tbr: 900},
        {format_id: "18", ext: "mp4", vcodec: "avc1.42001E", acodec: "mp4a.40.2", width: 640, height: 360, filesize: 5_000_000, tbr: 500},
    ],
};

type Call = { args: string[]; options: RunOptions };

export class FakeRunner implements ProcessRunner {
    readonly calls: Call[] = [];
    info: unknown = YT_INFO;
    fileBytes = 1024;
    failWith: Error | undefined;
    // Держит процесс «запущенным», пока тест не отпустит — для проверки семафора и обрыва.
    gate: Promise<void> | undefined;

    async run(args: string[], options: RunOptions): Promise<RunResult> {
        this.calls.push({args, options});
        if (this.gate) {
            await Promise.race([
                this.gate,
                new Promise((_, reject) => options.signal?.addEventListener("abort", () => reject(new Error("aborted")), {once: true})),
            ]);
        }
        if (this.failWith) throw this.failWith;
        if (args.includes("-J")) return {stdout: JSON.stringify(this.info), stderr: ""};

        const template = args[args.indexOf("-o") + 1]!;
        const ext = args.includes("-x") ? "mp3" : "mp4";
        await writeFile(template.replace("%(ext)s", ext), Buffer.alloc(this.fileBytes, 1));
        const titleFile = args[args.indexOf("--print-to-file") + 2]!;
        await writeFile(titleFile, (this.info as { title: string }).title + "\n");
        // Один тик watchdog, как у настоящего раннера: даёт событие прогресса и проверку размера.
        await options.watchdog?.();
        return {stdout: "", stderr: ""};
    }

    lastDownloadDir(): string {
        const call = [...this.calls].reverse().find((c) => !c.args.includes("-J"))!;
        return path.dirname(call.args[call.args.indexOf("-o") + 1]!);
    }
}

export function testEnv(tempDir: string, overrides: Record<string, string> = {}): Env {
    return loadEnv({NODE_ENV: "test", LOG_LEVEL: "silent", TEMP_DIR: tempDir, ...overrides});
}
