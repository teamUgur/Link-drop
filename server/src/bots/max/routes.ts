import {createHash, timingSafeEqual} from "node:crypto";
import type {FastifyPluginAsync} from "fastify";
import {AppError} from "../../errors.ts";
import {maxUpdateSchema} from "./schemas.ts";
import type {MaxBotService} from "./service.ts";

export type MaxRoutesOptions = {
    service: MaxBotService;
    secret: string;
};

export const SECRET_HEADER = "x-max-bot-api-secret";

// Хеш уравнивает длины: timingSafeEqual на буферах разной длины бросает, а ранний выход
// по длине сам по себе подсказывает длину секрета.
function sameSecret(actual: string, expected: string): boolean {
    const a = createHash("sha256").update(actual).digest();
    const b = createHash("sha256").update(expected).digest();
    return timingSafeEqual(a, b);
}

export const maxBotRoutes: FastifyPluginAsync<MaxRoutesOptions> = async (app, opts) => {
    app.post("/api/bots/max/webhook", async (request, reply) => {
        const header = request.headers[SECRET_HEADER];
        if (typeof header !== "string" || !sameSecret(header, opts.secret)) {
            throw new AppError("UNAUTHORIZED", 401, "Invalid webhook secret");
        }

        const parsed = maxUpdateSchema.safeParse(request.body);
        // Кривой апдейт подтверждаем 200: на любой другой ответ MAX будет повторять его 10 раз
        // восемь часов, а потом отпишет бота — повтор не исправит формат.
        if (!parsed.success) {
            request.log.warn({issues: parsed.error.issues}, "max update rejected by schema");
            return reply.send({ok: true});
        }
        opts.service.enqueue(parsed.data);
        return reply.send({ok: true});
    });
};
