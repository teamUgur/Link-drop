import {z} from "zod";
import {PRESET_IDS} from "./presets.ts";

// 2048 — практический потолок длины URL у браузеров и прокси; ссылки на видео намного короче.
const mediaUrl = z.string().trim().min(1).max(2048).pipe(z.url({protocol: /^https?$/}));

export const resolveBodySchema = z.object({
    url: mediaUrl,
});

export const prepareBodySchema = z.object({
    url: mediaUrl,
    format: z.enum(PRESET_IDS),
});

export const fileParamsSchema = z.object({
    id: z.uuid(),
});
