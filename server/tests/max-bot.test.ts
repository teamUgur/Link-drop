import {mkdtemp, readdir, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import type {FastifyInstance} from "fastify";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {buildApp} from "../src/app.ts";
import type {MaxBotService} from "../src/bots/max/service.ts";
import {FakeRunner, testEnv} from "./fake-runner.ts";

const SECRET = "test-secret-123";
const API = "https://max.test";

type Recorded = { method: string; url: string; body: unknown };

let tempRoot: string;
let runner: FakeRunner;
let app: FastifyInstance;
let bot: MaxBotService;
let calls: Recorded[];
let notReadyLeft: number;

function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = String(input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body instanceof FormData ? "<form>" : undefined;
    calls.push({method: init?.method ?? "GET", url, body});
    const json = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), {status}));

    if (url.startsWith(`${API}/uploads`)) return json({url: "https://upload.max.test/u1", token: "video-token"});
    if (url === "https://upload.max.test/u1") return json({});
    if (url.startsWith(`${API}/messages`)) {
        const hasAttachment = (body as { attachments?: unknown[] }).attachments !== undefined;
        if (hasAttachment && notReadyLeft > 0) {
            notReadyLeft--;
            return json({code: "attachment.not.ready", message: "not ready"}, 400);
        }
        return json({message: {}});
    }
    return json({code: "not.found"}, 404);
}

function update(text: string, mid = "mid-1", userId = 42) {
    return {
        update_type: "message_created",
        timestamp: 1,
        message: {
            sender: {user_id: userId, first_name: "U", is_bot: false},
            recipient: {chat_id: 1000 + userId, chat_type: "dialog"},
            timestamp: 1,
            body: {mid, seq: 1, text},
        },
    };
}

async function post(payload: unknown, secret: string | null = SECRET) {
    return app.inject({
        method: "POST",
        url: "/api/bots/max/webhook",
        payload: payload as object,
        headers: secret === null ? {} : {"x-max-bot-api-secret": secret},
    });
}

const messages = () => calls.filter((c) => c.url.startsWith(`${API}/messages`));

beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "linkdrop-bot-"));
    runner = new FakeRunner();
    calls = [];
    notReadyLeft = 0;
    const built = await buildApp({
        env: testEnv(tempRoot, {MAX_BOT_TOKEN: "bot-token", MAX_WEBHOOK_SECRET: SECRET, MAX_API_URL: API}),
        runner,
        maxFetch: fakeFetch as typeof fetch,
        maxSleep: () => Promise.resolve(),
    });
    app = built.app;
    bot = built.maxBot!;
    await app.ready();
});

afterEach(async () => {
    await app.close();
    await rm(tempRoot, {recursive: true, force: true});
});

describe("MAX webhook", () => {
    it.each([[null], ["wrong-secret"]])("rejects secret %s", async (secret) => {
        const res = await post(update("https://youtu.be/abc"), secret);
        expect(res.statusCode).toBe(401);
        expect(calls).toHaveLength(0);
    });

    it("downloads and sends video", async () => {
        const res = await post(update("смотри https://youtu.be/abc"));
        expect(res.statusCode).toBe(200);
        await bot.drain();

        expect(calls.map((c) => c.url)).toEqual([
            `${API}/messages?chat_id=1042`,
            `${API}/uploads?type=video`,
            "https://upload.max.test/u1",
            `${API}/messages?chat_id=1042`,
        ]);
        expect(messages()[1]!.body).toEqual({attachments: [{type: "video", payload: {token: "video-token"}}]});
        expect(await readdir(tempRoot)).toEqual([]);
    });

    it("retries attachment.not.ready", async () => {
        notReadyLeft = 2;
        await post(update("https://youtu.be/abc"));
        await bot.drain();
        expect(messages()).toHaveLength(4);
    });

    it("processes duplicate delivery once", async () => {
        await post(update("https://youtu.be/abc", "same-mid"));
        await post(update("https://youtu.be/abc", "same-mid"));
        await bot.drain();
        expect(runner.calls).toHaveLength(1);
    });

    it("answers without url", async () => {
        await post(update("привет"));
        await bot.drain();
        expect(messages()).toHaveLength(1);
        expect((messages()[0]!.body as { text: string }).text).toMatch(/ссылк/);
        expect(runner.calls).toHaveLength(0);
    });

    it("explains unsupported site", async () => {
        await post(update("https://example.com/v"));
        await bot.drain();
        expect((messages()[0]!.body as { text: string }).text).toMatch(/YouTube, Instagram и TikTok/);
        expect(runner.calls).toHaveLength(0);
    });

    it("one download per user at a time", async () => {
        let open!: () => void;
        runner.gate = new Promise((r) => (open = r));
        await post(update("https://youtu.be/abc", "m1"));
        await expect.poll(() => runner.calls.length).toBe(1);
        await post(update("https://youtu.be/def", "m2"));
        await expect.poll(() => messages().length).toBe(2);
        expect((messages()[1]!.body as { text: string }).text).toMatch(/Предыдущее/);
        open();
        await bot.drain();
    });

    it("acks malformed update with 200", async () => {
        const res = await post({update_type: "message_created", message: {nope: true}});
        expect(res.statusCode).toBe(200);
        await bot.drain();
        expect(calls).toHaveLength(0);
    });

    it("greets on bot_started", async () => {
        await post({update_type: "bot_started", chat_id: 5, user: {user_id: 7}});
        await bot.drain();
        expect(messages()[0]!.url).toBe(`${API}/messages?chat_id=5`);
    });
});
