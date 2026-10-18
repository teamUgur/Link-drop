import type {FastifyBaseLogger} from "fastify";
import {describe, expect, it, vi} from "vitest";
import {InvalidEnvError, loadEnv} from "../src/env.ts";
import {BusyError, MediaUnavailableError, UnsupportedSourceError, UpstreamError} from "../src/errors.ts";
import {PreparedFiles} from "../src/media/prepared-files.ts";
import {availableFormats} from "../src/media/presets.ts";
import {safeFileName} from "../src/media/service.ts";
import {detectSource, findUrl} from "../src/media/sources.ts";
import {translateError, YtDlpExitError} from "../src/media/ytdlp.ts";
import {contentDisposition} from "../src/shared/http.ts";
import {KeyedLimit} from "../src/shared/keyed-limit.ts";
import {Semaphore} from "../src/shared/semaphore.ts";
import {YT_INFO} from "./fake-runner.ts";

describe("detectSource", () => {
    it.each([
        ["https://www.youtube.com/watch?v=abc", "youtube"],
        ["https://youtu.be/abc", "youtube"],
        ["https://m.youtube.com/shorts/abc", "youtube"],
        ["http://www.instagram.com/reel/abc/", "instagram"],
        ["https://vm.tiktok.com/ZM123/", "tiktok"],
        ["https://WWW.TIKTOK.COM./@u/video/1", "tiktok"],
    ])("%s → %s", (url, source) => {
        expect(detectSource(url).source).toBe(source);
    });

    it.each([
        "https://evil.com/?youtube.com",
        "https://youtube.com.evil.com/watch",
        "https://notyoutube.com/watch",
        "https://user:pass@youtube.com/watch",
        "https://youtube.com:8443/watch",
        "ftp://youtube.com/x",
        "file:///etc/passwd",
        "not a url",
    ])("rejects %s", (url) => {
        expect(() => detectSource(url)).toThrow(UnsupportedSourceError);
    });

    it("normalizes to https", () => {
        expect(detectSource("http://youtube.com:80/watch?v=1").url).toBe("https://youtube.com/watch?v=1");
    });

    it("finds url in text", () => {
        expect(findUrl("глянь https://youtu.be/x123 круто")).toBe("https://youtu.be/x123");
        expect(findUrl("без ссылки")).toBeUndefined();
    });
});

describe("availableFormats", () => {
    it("maps youtube formats to presets with sizes", () => {
        const formats = availableFormats(YT_INFO.formats);
        expect(formats.map((f) => f.id)).toEqual(["mp4-1080", "mp4-720", "mp4-480", "mp3"]);
        // h264 предпочтён vp9 той же высоты, к видео без звука прибавлен лучший m4a.
        expect(formats[0]).toMatchObject({detail: "1920 × 1080", sizeBytes: 52_000_000});
        expect(formats[2]).toMatchObject({detail: "854 × 480", sizeBytes: 11_000_000});
        expect(formats[3]?.sizeBytes).toBeNull();
    });

    it("uses short side for vertical video and hides duplicate tiers", () => {
        const formats = availableFormats([{format_id: "v", width: 720, height: 1280, vcodec: "h264", acodec: "aac", filesize: 10}]);
        expect(formats.map((f) => f.id)).toEqual(["mp4-720", "mp3"]);
        expect(formats[0]?.detail).toBe("720 × 1280");
    });

    it("size is unknown when audio size is unknown", () => {
        const formats = availableFormats([
            {format_id: "v", width: 1280, height: 720, vcodec: "avc1", acodec: "none", filesize: 10},
            {format_id: "a", vcodec: "none", acodec: "mp4a"},
        ]);
        expect(formats[0]?.sizeBytes).toBeNull();
    });

    it("returns nothing for empty formats", () => {
        expect(availableFormats([])).toEqual([]);
    });
});

describe("translateError", () => {
    it.each([
        ["ERROR: [youtube] x: Private video. Sign in", MediaUnavailableError],
        ["ERROR: [youtube] x: This video is unavailable", MediaUnavailableError],
        ["ERROR: No suitable extractor found for URL", MediaUnavailableError],
        ["ERROR: Unsupported URL: https://x", UnsupportedSourceError],
        ["ERROR: Sign in to confirm you’re not a bot", UpstreamError],
        ["ERROR: something new and unknown", UpstreamError],
    ])("%s", (stderr, type) => {
        expect(translateError(new YtDlpExitError(1, stderr))).toBeInstanceOf(type);
    });
});

describe("Semaphore", () => {
    it("limits concurrency and rejects when queue is full", async () => {
        const s = new Semaphore(1, 1);
        const r1 = await s.acquire();
        const p2 = s.acquire();
        await expect(s.acquire()).rejects.toBeInstanceOf(BusyError);
        r1();
        r1(); // повторный release не должен освобождать второй слот
        const r2 = await p2;
        expect(s.activeCount).toBe(1);
        r2();
        expect(s.activeCount).toBe(0);
    });

    it("removes aborted waiter from queue", async () => {
        const s = new Semaphore(1, 1);
        const r1 = await s.acquire();
        const controller = new AbortController();
        const waiting = s.acquire(controller.signal);
        controller.abort();
        await expect(waiting).rejects.toBeDefined();
        expect(s.queuedCount).toBe(0);
        r1();
        expect(s.activeCount).toBe(0);
    });
});

describe("file names", () => {
    it("sanitizes title", () => {
        expect(safeFileName("a/b\\c:d*?\"<>|e")).toBe("a_b_c_d______e");
        expect(safeFileName("  ...  ")).toBe("video");
        expect(Array.from(safeFileName("😀".repeat(200)))).toHaveLength(120);
    });

    it("encodes content-disposition for non-ascii", () => {
        expect(contentDisposition("Кот's (1).mp4")).toBe(
            "attachment; filename=\"___'s (1).mp4\"; filename*=UTF-8''%D0%9A%D0%BE%D1%82%27s%20%281%29.mp4",
        );
    });
});

describe("env", () => {
    it("requires webhook secret when bot token set", () => {
        expect(() => loadEnv({MAX_BOT_TOKEN: "t"})).toThrow(InvalidEnvError);
    });

    it("treats empty strings as unset", () => {
        expect(loadEnv({MAX_BOT_TOKEN: "", MAX_WEBHOOK_SECRET: ""}).MAX_BOT_TOKEN).toBeUndefined();
    });

    it("bot must leave download slots for the site", () => {
        const bot = {MAX_BOT_TOKEN: "t", MAX_WEBHOOK_SECRET: "secret-1"};
        expect(() => loadEnv({...bot, DOWNLOAD_CONCURRENCY: "2", BOT_DOWNLOAD_CONCURRENCY: "2"})).toThrow(/BOT_DOWNLOAD_CONCURRENCY/);
        expect(loadEnv({...bot, DOWNLOAD_CONCURRENCY: "3", BOT_DOWNLOAD_CONCURRENCY: "2"}).BOT_DOWNLOAD_CONCURRENCY).toBe(2);
        // Без бота ограничение не мешает однослотовой конфигурации.
        expect(loadEnv({DOWNLOAD_CONCURRENCY: "1"}).DOWNLOAD_CONCURRENCY).toBe(1);
    });

    it("coerces numbers", () => {
        expect(loadEnv({MAX_FILE_MB: "2"}).MAX_FILE_MB).toBe(2);
    });
});

describe("PreparedFiles", () => {
    // Сессия и IP совпадают по значению только для краткости: в тестах важно, разные они или нет.
    const own = (session: string, ip = session) => ({session, ip});
    const log = {error: vi.fn()} as unknown as FastifyBaseLogger;
    const fakeFile = () => {
        const file = {filePath: "/x", sizeBytes: 1, fileName: "a.mp4", contentType: "video/mp4", cleanup: vi.fn(async () => {})};
        return file;
    };

    it("expires unclaimed file after ttl", async () => {
        const files = new PreparedFiles(20, 10, 10, log);
        const file = fakeFile();
        const id = files.put(file, own("1.1.1.1"));
        expect(files.get(id)).toBe(file);
        await expect.poll(() => file.cleanup.mock.calls.length).toBe(1);
        expect(files.get(id)).toBeUndefined();
    });

    it("evicts oldest over limit", () => {
        const files = new PreparedFiles(60_000, 2, 10, log);
        const [a, b, c] = [fakeFile(), fakeFile(), fakeFile()];
        const ida = files.put(a, own("1.1.1.1"));
        files.put(b, own("2.2.2.2"));
        files.put(c, own("3.3.3.3"));
        expect(files.get(ida)).toBeUndefined();
        expect(a.cleanup).toHaveBeenCalledOnce();
        expect(files.size).toBe(2);
        void files.clear();
    });

    it("complete removes once; get keeps file for retry", () => {
        const files = new PreparedFiles(60_000, 2, 10, log);
        const file = fakeFile();
        const id = files.put(file, own("1.1.1.1"));
        files.get(id);
        expect(file.cleanup).not.toHaveBeenCalled();
        files.complete(id);
        files.complete(id);
        expect(file.cleanup).toHaveBeenCalledOnce();
    });

    it("new file of the same owner replaces the old one, others stay", () => {
        const files = new PreparedFiles(60_000, 10, 10, log);
        const [a, b, other] = [fakeFile(), fakeFile(), fakeFile()];
        const ida = files.put(a, own("1.1.1.1"));
        const idOther = files.put(other, own("2.2.2.2"));
        const idb = files.put(b, own("1.1.1.1"));
        expect(files.get(ida)).toBeUndefined();
        expect(a.cleanup).toHaveBeenCalledOnce();
        expect(files.get(idb)).toBe(b);
        expect(files.get(idOther)).toBe(other);

        // Забранный файл освобождает владельца: следующий кладётся без вытеснения чужих.
        files.complete(idb);
        files.put(fakeFile(), own("1.1.1.1"));
        expect(files.size).toBe(2);
        void files.clear();
    });

    it("per-ip cap replaces the oldest unclaimed file of that ip, even across sessions", () => {
        const files = new PreparedFiles(60_000, 10, 2, log);
        const [a, b, c, other] = [fakeFile(), fakeFile(), fakeFile(), fakeFile()];
        // Без cookie каждый запрос — новая сессия; потолок IP всё равно держит.
        const ida = files.put(a, own("s1", "9.9.9.9"));
        const idb = files.put(b, own("s2", "9.9.9.9"));
        const idOther = files.put(other, own("s9", "8.8.8.8"));
        const idc = files.put(c, own("s3", "9.9.9.9"));
        expect(files.get(ida)).toBeUndefined();
        expect(files.get(idb)).toBe(b);
        expect(files.get(idc)).toBe(c);
        expect(files.get(idOther)).toBe(other);
        void files.clear();
    });
});

describe("KeyedLimit", () => {
    it("caps holders per key, release is idempotent and drops empty keys", () => {
        const limit = new KeyedLimit(2);
        const r1 = limit.tryAcquire("a")!;
        const r2 = limit.tryAcquire("a")!;
        expect(limit.tryAcquire("a")).toBeUndefined();
        expect(limit.tryAcquire("b")).toBeDefined();
        r1();
        r1();
        const r3 = limit.tryAcquire("a")!;
        expect(limit.tryAcquire("a")).toBeUndefined();
        r2();
        r3();
        expect(limit.size).toBe(1);
    });
});
