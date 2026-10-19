import {setTimeout as sleep} from "node:timers/promises";
import {buildApp} from "./app.ts";
import {InvalidEnvError, loadEnv, type Env} from "./env.ts";
import {cleanTempRoot} from "./shared/temp-dir.ts";

// Сколько ждём начатые загрузки бота при остановке. Должно быть меньше stop_grace_period
// в docker-compose, иначе Docker убьёт процесс раньше, чем мы закончим.
const BOT_DRAIN_TIMEOUT_MS = 90_000;

let env: Env;
try {
    env = loadEnv();
} catch (e) {
    if (e instanceof InvalidEnvError) {
        console.error(e.message);
        process.exit(1);
    }
    throw e;
}

await cleanTempRoot(env.TEMP_DIR);
const {app, maxBot} = await buildApp({env});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({signal}, "shutting down");
    try {
        // close() перестаёт принимать запросы и ждёт текущие, включая отдачу файлов.
        await app.close();
        if (maxBot && maxBot.pendingCount > 0) {
            app.log.info({pending: maxBot.pendingCount}, "waiting for MAX bot jobs");
            await Promise.race([maxBot.drain(), sleep(BOT_DRAIN_TIMEOUT_MS)]);
        }
        process.exit(0);
    } catch (e) {
        app.log.error({err: e}, "shutdown failed");
        process.exit(1);
    }
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

try {
    await app.listen({host: env.HOST, port: env.PORT});
} catch (e) {
    app.log.fatal({err: e}, "failed to start");
    process.exit(1);
}
