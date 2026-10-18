import {z} from "zod";

// Описаны только поля, которые читает бот; остальное zod пропускает молча (object без strict),
// чтобы новые поля в апдейтах MAX не ломали приём.
const userSchema = z.object({
    user_id: z.number().int(),
    is_bot: z.boolean().optional(),
});

const messageSchema = z.object({
    sender: userSchema.nullish(),
    recipient: z.object({
        chat_id: z.number().int().nullish(),
        user_id: z.number().int().nullish(),
    }),
    body: z.object({
        mid: z.string().min(1),
        text: z.string().nullish(),
    }),
});

export const maxUpdateSchema = z.object({
    update_type: z.string(),
    timestamp: z.number().optional(),
    message: messageSchema.optional(),
    chat_id: z.number().int().optional(),
    user: userSchema.optional(),
});

export type MaxUpdate = z.infer<typeof maxUpdateSchema>;
