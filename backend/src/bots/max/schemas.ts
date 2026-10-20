import {z} from "zod";

// Описаны только поля, которые читает бот; остальное zod пропускает молча (object без strict),
// чтобы новые поля в апдейтах MAX не ломали приём. Схема — github.com/max-messenger/api-schema.
const userSchema = z.object({
    user_id: z.number().int(),
    is_bot: z.boolean().optional(),
});

// Вложения и разметку разбираем мягко: неизвестный тип или кривое поле внутри одного элемента
// не должны отбрасывать весь апдейт — ссылка могла быть и в тексте.
const shareAttachmentSchema = z.object({
    type: z.literal("share"),
    payload: z.object({url: z.string().nullish()}).nullish(),
});
const linkMarkupSchema = z.object({
    type: z.literal("link"),
    url: z.string(),
});
const looseArray = <T extends z.ZodType>(item: T) =>
    z.array(z.unknown()).nullish().transform((items) => (items ?? []).flatMap((i) => {
        const parsed = item.safeParse(i);
        return parsed.success ? [parsed.data as z.infer<T>] : [];
    }));

const bodySchema = z.object({
    mid: z.string().min(1),
    text: z.string().nullish(),
    attachments: looseArray(shareAttachmentSchema),
    markup: looseArray(linkMarkupSchema),
});

export type MaxMessageBody = z.infer<typeof bodySchema>;

const messageSchema = z.object({
    sender: userSchema.nullish(),
    recipient: z.object({
        chat_id: z.number().int().nullish(),
        // dialog — личка с ботом; chat — группа; channel — канал.
        chat_type: z.string().nullish(),
        user_id: z.number().int().nullish(),
    }),
    timestamp: z.number().optional(),
    // body бывает null, когда сообщение — только пересылка: тогда ссылка лежит в link.message.
    body: bodySchema.nullish(),
    link: z.object({
        type: z.string().optional(),
        message: bodySchema.nullish(),
    }).nullish(),
});

export const maxUpdateSchema = z.object({
    update_type: z.string(),
    timestamp: z.number().optional(),
    message: messageSchema.optional(),
    chat_id: z.number().int().optional(),
    user: userSchema.optional(),
});

export type MaxUpdate = z.infer<typeof maxUpdateSchema>;
