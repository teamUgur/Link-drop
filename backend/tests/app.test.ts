import {existsSync} from "node:fs";
import {mkdtemp, readdir, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import type {FastifyInstance} from "fastify";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {buildApp} from "../src/app.ts";
import {UpstreamTimeoutError} from "../src/errors.ts";
import {YtDlpExitError} from "../src/media/ytdlp.ts";
import {FakeRunner, testEnv} from "./fake-runner.ts";

let tempRoot: string;
let runner: FakeRunner;
let app: FastifyInstance;

async function start(overrides: Record<string, string> = {}) {
    app = (await buildApp({env: testEnv(tempRoot, overrides), runner})).app;
    await app.ready();
}

const YT = "https://www.youtube.com/watch?v=abc";
const downloadUrl = (format: string, url = YT) => `/api/media/download?url=${encodeURIComponent(url)}&format=${format}`;

beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "linkdrop-test-"));
    runner = new FakeRunner();
});

afterEach(async () => {
    await app?.close();
    await rm(tempRoot, {recursive: true, force: true});
});

describe("health", () => {
    it("returns ok", async () => {
        await start();
        const res = await app.inject({method: "GET", url: "/api/health"});
        expect(res.json()).toEqual({status: "ok"});
    });

    it("unknown route is json 404", async () => {
        await start();
        const res = await app.inject({method: "GET", url: "/api/nope"});
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe("NOT_FOUND");
    });
});

describe("POST /api/media/resolve", () => {
    it("returns card and formats", async () => {
        await start();
        const res = await app.inject({method: "POST", url: "/api/media/resolve", payload: {url: YT}});
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body).toMatchObject({source: "youtube", title: "Тест / видео: \"кавычки\"", durationSec: 120});
        expect(body.formats.map((f: { id: string }) => f.id)).toEqual(["mp4-1080", "mp4-720", "mp4-480", "mp3"]);

        const args = runner.calls[0]!.args;
        expect(args).toContain("--ignore-config");
        expect(args.slice(-2)).toEqual(["--", YT]);
        expect(args[args.indexOf("--use-extractors") + 1]).toBe("youtube");
    });

    it("leaves no temp dirs", async () => {
        await start();
        await app.inject({method: "POST", url: "/api/media/resolve", payload: {url: YT}});
        expect(await readdir(tempRoot)).toEqual([]);
    });

    it.each([
        [{}, 400, "VALIDATION_ERROR"],
        [{url: "not a url"}, 400, "VALIDATION_ERROR"],
        [{url: "https://example.com/video"}, 422, "UNSUPPORTED_SOURCE"],
        [{url: "http://169.254.169.254/latest"}, 422, "UNSUPPORTED_SOURCE"],
    ])("%j → %i", async (payload, status, code) => {
        await start();
        const res = await app.inject({method: "POST", url: "/api/media/resolve", payload});
        expect(res.statusCode).toBe(status);
        expect(res.json().error.code).toBe(code);
        expect(runner.calls).toHaveLength(0);
    });

    it("rejects broken json as 400", async () => {
        await start();
        const res = await app.inject({method: "POST", url: "/api/media/resolve", headers: {"content-type": "application/json"}, payload: "{"});
        expect(res.statusCode).toBe(400);
    });

    it("rejects too long video", async () => {
        await start({MAX_DURATION_SEC: "60"});
        const res = await app.inject({method: "POST", url: "/api/media/resolve", payload: {url: YT}});
        expect(res.json().error.code).toBe("TOO_LARGE");
    });

    it("rejects live streams", async () => {
        runner.info = {...(runner.info as object), is_live: true};
        await start();
        const res = await app.inject({method: "POST", url: "/api/media/resolve", payload: {url: YT}});
        expect(res.json().error.code).toBe("MEDIA_UNAVAILABLE");
    });

    it("rejects playlists", async () => {
        runner.info = {_type: "playlist", entries: []};
        await start();
        const res = await app.inject({method: "POST", url: "/api/media/resolve", payload: {url: YT}});
        expect(res.json().error.code).toBe("MEDIA_UNAVAILABLE");
    });

    it("maps yt-dlp errors", async () => {
        runner.failWith = new YtDlpExitError(1, "ERROR: [youtube] abc: Private video");
        await start();
        const res = await app.inject({method: "POST", url: "/api/media/resolve", payload: {url: YT}});
        expect(res.statusCode).toBe(422);
        expect(res.json().error.code).toBe("MEDIA_UNAVAILABLE");
    });

    it("maps timeout to 504", async () => {
        runner.failWith = new UpstreamTimeoutError();
        await start();
        const res = await app.inject({method: "POST", url: "/api/media/resolve", payload: {url: YT}});
        expect(res.statusCode).toBe(504);
    });

    it("rate limits per ip", async () => {
        await start({RATE_LIMIT_RESOLVE_PER_MIN: "2"});
        for (let i = 0; i < 2; i++) await app.inject({method: "POST", url: "/api/media/resolve", payload: {url: YT}});
        const res = await app.inject({method: "POST", url: "/api/media/resolve", payload: {url: YT}});
        expect(res.statusCode).toBe(429);
        expect(res.json().error.code).toBe("RATE_LIMITED");
        expect(res.headers["retry-after"]).toBeDefined();
    });

    it("ignores X-Forwarded-For without trusted proxy", async () => {
        await start({RATE_LIMIT_RESOLVE_PER_MIN: "1"});
        await app.inject({method: "POST", url: "/api/media/resolve", payload: {url: YT}, headers: {"x-forwarded-for": "1.1.1.1"}});
        const res = await app.inject({method: "POST", url: "/api/media/resolve", payload: {url: YT}, headers: {"x-forwarded-for": "2.2.2.2"}});
        expect(res.statusCode).toBe(429);
    });

    it("uses X-Forwarded-For behind trusted proxy", async () => {
        await start({RATE_LIMIT_RESOLVE_PER_MIN: "1", TRUST_PROXY_HOPS: "1"});
        await app.inject({method: "POST", url: "/api/media/resolve", payload: {url: YT}, headers: {"x-forwarded-for": "1.1.1.1"}});
        const res = await app.inject({method: "POST", url: "/api/media/resolve", payload: {url: YT}, headers: {"x-forwarded-for": "2.2.2.2"}});
        expect(res.statusCode).toBe(200);
    });
});

const prepare = (format: string, url = YT, ip = "127.0.0.1", sid?: string) =>
    app.inject({method: "POST", url: "/api/media/prepare", payload: {url, format}, remoteAddress: ip, ...(sid ? {cookies: {ld_sid: sid}} : {})});
const SID_A = "11111111-1111-4111-8111-111111111111";
const SID_B = "22222222-2222-4222-8222-222222222222";
const SID_C = "33333333-3333-4333-8333-333333333333";
const events = (payload: string) => payload.trim().split("\n").map((line) => JSON.parse(line));

describe("POST /api/media/prepare + GET /api/media/files/:id", () => {
    it("streams progress, then serves file once and removes temp dir", async () => {
        runner.fileBytes = 4096;
        await start();
        const res = await prepare("mp4-720");
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toContain("application/x-ndjson");
        const lines = events(res.payload);
        expect(lines[0]).toEqual({type: "started"});
        expect(lines).toContainEqual({type: "progress", downloadedBytes: expect.any(Number)});
        const ready = lines.at(-1);
        expect(ready).toMatchObject({type: "ready", sizeBytes: 4096, fileName: expect.stringMatching(/\.mp4$/)});

        const args = runner.calls[0]!.args;
        expect(args[args.indexOf("-S") + 1]).toMatch(/^res:720,/);
        expect(args).toContain("--max-filesize");

        const file = await app.inject({method: "GET", url: ready.fileUrl});
        expect(file.statusCode).toBe(200);
        expect(file.headers["content-type"]).toBe("video/mp4");
        expect(file.headers["content-length"]).toBe("4096");
        expect(file.headers["content-disposition"]).toContain("filename*=UTF-8''");
        expect(file.rawPayload).toHaveLength(4096);
        await expect.poll(() => existsSync(runner.lastDownloadDir())).toBe(false);

        const again = await app.inject({method: "GET", url: ready.fileUrl});
        expect(again.statusCode).toBe(404);
        expect(again.json().error.code).toBe("FILE_EXPIRED");
    });

    it("mp3 uses audio extraction", async () => {
        await start();
        const ready = events((await prepare("mp3")).payload).at(-1);
        const file = await app.inject({method: "GET", url: ready.fileUrl});
        expect(file.headers["content-type"]).toBe("audio/mpeg");
        expect(runner.calls[0]!.args).toContain("-x");
    });

    it("rejects unknown preset without running yt-dlp", async () => {
        await start();
        const res = await prepare("bestvideo+bestaudio");
        expect(res.statusCode).toBe(400);
        expect(runner.calls).toHaveLength(0);
    });

    it("rejects foreign site with status before stream", async () => {
        await start();
        const res = await prepare("mp4-720", "https://example.com/v");
        expect(res.statusCode).toBe(422);
        expect(res.json().error.code).toBe("UNSUPPORTED_SOURCE");
    });

    it("too large file becomes error event and cleans up", async () => {
        runner.fileBytes = 2 * 1024 * 1024;
        await start({MAX_FILE_MB: "1"});
        const res = await prepare("mp4-480");
        expect(res.statusCode).toBe(200);
        expect(events(res.payload).at(-1)).toMatchObject({type: "error", error: {code: "TOO_LARGE"}});
        expect(existsSync(runner.lastDownloadDir())).toBe(false);
    });

    it("upstream failure becomes error event and removes temp dir", async () => {
        runner.failWith = new YtDlpExitError(1, "ERROR: weird");
        await start();
        const res = await prepare("mp4-720");
        expect(events(res.payload).at(-1)).toMatchObject({type: "error", error: {code: "UPSTREAM_ERROR"}});
        expect(await readdir(tempRoot)).toEqual([]);
    });

    it("returns BUSY with Retry-After when slots and queue are full", async () => {
        let open!: () => void;
        runner.gate = new Promise((r) => (open = r));
        await start({DOWNLOAD_CONCURRENCY: "1", QUEUE_LIMIT: "0"});
        const first = prepare("mp4-720", YT, "10.0.0.1");
        await expect.poll(() => runner.calls.length).toBe(1);

        const second = await prepare("mp4-720", YT, "10.0.0.2");
        expect(second.statusCode).toBe(503);
        expect(second.json().error.code).toBe("BUSY");
        expect(second.headers["retry-after"]).toBe("30");

        open();
        expect(events((await first).payload).at(-1).type).toBe("ready");
    });

    it("issues a session cookie when there is none or it is not a uuid", async () => {
        await start();
        const fresh = await prepare("mp4-720");
        const cookie = fresh.cookies.find((c) => c.name === "ld_sid")!;
        expect(cookie.value).toMatch(/^[0-9a-f-]{36}$/);
        expect(cookie).toMatchObject({path: "/api/media", httpOnly: true, sameSite: "Lax"});
        expect(cookie.secure).toBeFalsy();

        const forged = await app.inject({method: "POST", url: "/api/media/prepare", payload: {url: YT, format: "mp3"}, cookies: {ld_sid: "x"}});
        expect(forged.cookies.find((c) => c.name === "ld_sid")!.value).not.toBe("x");
        const kept = await prepare("mp3", YT, "127.0.0.1", SID_A);
        expect(kept.cookies.find((c) => c.name === "ld_sid")).toBeUndefined();
    });

    it("one prepare per browser; another browser on the same ip goes up to DOWNLOADS_PER_IP", async () => {
        let open!: () => void;
        runner.gate = new Promise((r) => (open = r));
        await start({DOWNLOADS_PER_IP: "2"});
        const first = prepare("mp4-720", YT, "10.0.0.1", SID_A);
        await expect.poll(() => runner.calls.length).toBe(1);

        const sameBrowser = await prepare("mp4-480", YT, "10.0.0.1", SID_A);
        expect(sameBrowser.statusCode).toBe(429);
        expect(sameBrowser.json().error.code).toBe("DOWNLOAD_IN_PROGRESS");

        // Коллега за тем же NAT — качает параллельно.
        const colleague = prepare("mp4-720", YT, "10.0.0.1", SID_B);
        await expect.poll(() => runner.calls.length).toBe(2);

        // Третий браузер с того же IP упирается в потолок сети; без cookie — тоже.
        const third = await prepare("mp4-720", YT, "10.0.0.1", SID_C);
        expect(third.json().error.code).toBe("NETWORK_DOWNLOADS_LIMIT");
        expect((await prepare("mp4-720", YT, "10.0.0.1")).json().error.code).toBe("NETWORK_DOWNLOADS_LIMIT");
        // Отказ по IP не держит сессию: SID_C свободен, как только IP освободится.
        expect(runner.calls).toHaveLength(2);

        open();
        expect(events((await first).payload).at(-1).type).toBe("ready");
        expect(events((await colleague).payload).at(-1).type).toBe("ready");
        expect(events((await prepare("mp3", YT, "10.0.0.1", SID_C)).payload).at(-1).type).toBe("ready");
    });

    it("ipv6 addresses of one /64 share the network cap", async () => {
        let open!: () => void;
        runner.gate = new Promise((r) => (open = r));
        await start({DOWNLOADS_PER_IP: "1"});
        const first = prepare("mp4-720", YT, "2001:db8:1:2::1");
        await expect.poll(() => runner.calls.length).toBe(1);
        const sibling = await prepare("mp4-720", YT, "2001:db8:1:2:ffff::9");
        expect(sibling.json().error.code).toBe("NETWORK_DOWNLOADS_LIMIT");
        open();
        await first;
    });

    it("lock is released when prepare fails", async () => {
        runner.failWith = new YtDlpExitError(1, "ERROR: weird");
        await start();
        expect(events((await prepare("mp4-720")).payload).at(-1).error.code).toBe("UPSTREAM_ERROR");
        expect((await prepare("mp4-720", "https://example.com/v")).statusCode).toBe(422);
        runner.failWith = undefined;
        expect(events((await prepare("mp4-720")).payload).at(-1).type).toBe("ready");
    });

    it("new file of the same browser replaces its unclaimed previous file", async () => {
        await start();
        const firstReady = events((await prepare("mp4-720", YT, "127.0.0.1", SID_A)).payload).at(-1);
        const firstDir = runner.lastDownloadDir();
        const secondReady = events((await prepare("mp3", YT, "127.0.0.1", SID_A)).payload).at(-1);
        expect((await app.inject({method: "GET", url: firstReady.fileUrl})).statusCode).toBe(404);
        await expect.poll(() => existsSync(firstDir)).toBe(false);
        expect((await app.inject({method: "GET", url: secondReady.fileUrl})).statusCode).toBe(200);
    });

    it("HEAD returns headers and does not consume the file", async () => {
        runner.fileBytes = 2048;
        await start();
        const ready = events((await prepare("mp4-720")).payload).at(-1);

        const head = await app.inject({method: "HEAD", url: ready.fileUrl});
        expect(head.statusCode).toBe(200);
        expect(head.headers["content-length"]).toBe("2048");
        expect(head.headers["content-disposition"]).toContain("attachment");
        expect(head.rawPayload).toHaveLength(0);

        const file = await app.inject({method: "GET", url: ready.fileUrl});
        expect(file.statusCode).toBe(200);
        expect(file.rawPayload).toHaveLength(2048);
    });

    it("file id must be uuid; unknown uuid is 404", async () => {
        await start();
        expect((await app.inject({method: "GET", url: "/api/media/files/../../etc"})).statusCode).toBe(404);
        expect((await app.inject({method: "GET", url: "/api/media/files/abc"})).statusCode).toBe(400);
        const res = await app.inject({method: "GET", url: "/api/media/files/6f1c1a52-2d4e-4f0e-9a43-0c0b3d1e5a10"});
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe("FILE_EXPIRED");
    });

    it("unclaimed files are removed on app close", async () => {
        await start();
        await prepare("mp4-720");
        const dir = runner.lastDownloadDir();
        expect(existsSync(dir)).toBe(true);
        await app.close();
        expect(existsSync(dir)).toBe(false);
    });
});
