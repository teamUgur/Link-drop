import {loadEnv} from "../../env.ts";
import {MaxClient} from "./client.ts";

// Подписка — разовая операция при деплое или смене домена, поэтому отдельный скрипт,
// а не вызов на старте: перезапуск сервера не должен трогать внешний сервис.
const env = loadEnv();
if (!env.MAX_BOT_TOKEN || !env.MAX_WEBHOOK_SECRET || !env.MAX_WEBHOOK_URL) {
    console.error("Нужны MAX_BOT_TOKEN, MAX_WEBHOOK_SECRET и MAX_WEBHOOK_URL");
    process.exit(1);
}
if (!env.MAX_WEBHOOK_URL.startsWith("https://")) {
    console.error("MAX_WEBHOOK_URL должен начинаться с https:// (MAX принимает только 443 порт)");
    process.exit(1);
}

const client = new MaxClient(env.MAX_API_URL, env.MAX_BOT_TOKEN);
const result = await client.subscribe(env.MAX_WEBHOOK_URL, env.MAX_WEBHOOK_SECRET, ["message_created", "bot_started"]);
console.log(JSON.stringify(result));
