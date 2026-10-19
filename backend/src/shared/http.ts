import type {FastifyReply} from "fastify";
import type {z} from "zod";
import {ValidationError} from "../errors.ts";

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
    const result = schema.safeParse(data);
    if (!result.success) {
        throw new ValidationError(result.error.issues.map((i) => ({path: i.path.join("."), message: i.message})));
    }
    return result.data;
}

// Сигнал «клиент ушёл». Слушаем закрытие ответа, а не запроса: у IncomingMessage 'close'
// в Node ≥ 16 срабатывает сразу после чтения тела, то есть на каждом GET, а не при обрыве.
export function clientGoneSignal(reply: FastifyReply): AbortSignal {
    const controller = new AbortController();
    reply.raw.once("close", () => {
        if (!reply.raw.writableFinished) controller.abort();
    });
    return controller.signal;
}

// filename= — ASCII-запасной вариант для старых клиентов, filename*= (RFC 6266/5987) — настоящее
// имя в UTF-8. Без этого кириллица в названии ломает заголовок или превращается в «????».
export function contentDisposition(fileName: string): string {
    const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
