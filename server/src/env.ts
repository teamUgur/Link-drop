import {z} from "zod";

// Пустая строка в .env («MAX_BOT_TOKEN=») — это «не задано», а не значение: иначе
// z.string().min(1) роняет старт на закомментированном шаблоне.
const optionalString = z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());

const envSchema = z.object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    HOST: z.string().min(1).default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

    // Сколько прокси стоит перед нами (Caddy = 1). 0 — доверять только сокету: иначе любой
    // клиент подставит X-Forwarded-For и обойдёт rate limit по IP.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

    YTDLP_PATH: z.string().min(1).default("yt-dlp"),
    // YouTube с конца 2025 требует JS-рантайм для расшифровки подписи. Node у нас уже есть,
    // ставить ради этого deno в образ незачем.
    YTDLP_JS_RUNTIME: z.string().min(1).default("node"),
    YTDLP_COOKIES_FILE: optionalString,
    TEMP_DIR: z.string().min(1).default("/tmp/linkdrop"),

    RESOLVE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
    DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10 * 60_000),
    MAX_DURATION_SEC: z.coerce.number().int().min(1).default(60 * 60),
    MAX_FILE_MB: z.coerce.number().int().min(1).default(500),

    // Сколько живёт готовый файл, если его не забрали, и сколько таких файлов держим на диске.
    // Фронт забирает файл сразу; TTL — на случай закрытой вкладки. Худший случай диска:
    // (PREPARED_FILES_LIMIT + DOWNLOAD_CONCURRENCY) × MAX_FILE_MB.
    PREPARED_FILE_TTL_SEC: z.coerce.number().int().min(10).default(5 * 60),
    PREPARED_FILES_LIMIT: z.coerce.number().int().min(1).default(10),

    RESOLVE_CONCURRENCY: z.coerce.number().int().min(1).default(8),
    DOWNLOAD_CONCURRENCY: z.coerce.number().int().min(1).default(3),
    // Очередь ограничена: ждать слота дольше пары минут клиент всё равно не станет,
    // а безлимитная очередь копит висящие соединения.
    QUEUE_LIMIT: z.coerce.number().int().min(0).default(10),

    RATE_LIMIT_RESOLVE_PER_MIN: z.coerce.number().int().min(1).default(20),
    RATE_LIMIT_DOWNLOAD_PER_MIN: z.coerce.number().int().min(1).default(6),

    // Одновременных подготовок с одного IP. Браузеру — всегда одна (cookie сессии), но cookie
    // атакующий просто не пошлёт, поэтому граница от злоупотребления — этот потолок.
    // 15 — решение Ильи: за мобильным CGNAT и в офисах много людей на одном IP, и они не должны
    // упираться в лимит. Цена: пока 15 > DOWNLOAD_CONCURRENCY + QUEUE_LIMIT, один адрес может
    // занять все слоты и очередь; строже — только капча/аккаунты (обсуждали SmartCaptcha, ALTCHA).
    DOWNLOADS_PER_IP: z.coerce.number().int().min(1).default(15),

    // Сколько слотов загрузки из DOWNLOAD_CONCURRENCY может занять бот. Должно быть меньше:
    // аккаунт в MAX бесплатный, и пачка аккаунтов иначе заняла бы все слоты сайта.
    BOT_DOWNLOAD_CONCURRENCY: z.coerce.number().int().min(1).default(2),

    MAX_BOT_TOKEN: optionalString,
    MAX_WEBHOOK_SECRET: z.preprocess(
        (v) => (v === "" ? undefined : v),
        z.string().regex(/^[a-zA-Z0-9_-]{5,256}$/, "5–256 символов: латиница, цифры, _ и -").optional(),
    ),
    MAX_WEBHOOK_URL: optionalString,
    MAX_API_URL: z.url().default("https://platform-api2.max.ru"),
}).superRefine((e, ctx) => {
    // Webhook без секрета принимает апдейты от кого угодно — бот без секрета не запускаем.
    if (e.MAX_BOT_TOKEN && !e.MAX_WEBHOOK_SECRET) {
        ctx.addIssue({code: "custom", path: ["MAX_WEBHOOK_SECRET"], message: "обязателен, когда задан MAX_BOT_TOKEN"});
    }
    if (e.MAX_BOT_TOKEN && e.BOT_DOWNLOAD_CONCURRENCY >= e.DOWNLOAD_CONCURRENCY) {
        ctx.addIssue({code: "custom", path: ["BOT_DOWNLOAD_CONCURRENCY"], message: "должно быть меньше DOWNLOAD_CONCURRENCY, иначе бот может занять все слоты сайта"});
    }
});

export type Env = z.infer<typeof envSchema>;

export class InvalidEnvError extends Error {
    constructor(details: string) {
        super("Invalid environment variables:\n" + details);
        this.name = "InvalidEnvError";
    }
}

// Без process.exit внутри: решение «упасть» принимает точка входа, а тесты собирают env из объекта.
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
    const result = envSchema.safeParse(source);
    if (!result.success) {
        throw new InvalidEnvError(z.prettifyError(result.error));
    }
    return result.data;
}
