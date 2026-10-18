import {UnsupportedSourceError} from "../errors.ts";

export type Source = "youtube" | "instagram" | "tiktok";

const DOMAINS: Record<Source, readonly string[]> = {
    youtube: ["youtube.com", "youtu.be", "youtube-nocookie.com"],
    instagram: ["instagram.com"],
    tiktok: ["tiktok.com"],
};

// Имена экстракторов yt-dlp. Передаются в --use-extractors: даже если ссылка прошла allowlist,
// а платформа редиректит куда-то ещё, generic-экстрактор не включится и не пойдёт по чужому URL.
export const EXTRACTORS: Record<Source, string> = {
    youtube: "youtube",
    instagram: "instagram",
    // vm.tiktok — короткие ссылки vm./vt.tiktok.com, которыми делятся из приложения.
    tiktok: "tiktok,vm.tiktok",
};

function matchesDomain(hostname: string, domain: string): boolean {
    return hostname === domain || hostname.endsWith("." + domain);
}

// Проверка по hostname из WHATWG URL, а не регуляркой по строке: «evil.com/?youtube.com»
// и «youtube.com.evil.com» проходят регулярку, но не эту проверку.
export function detectSource(rawUrl: string): { source: Source; url: string } {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new UnsupportedSourceError();
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new UnsupportedSourceError();
    if (parsed.username || parsed.password) throw new UnsupportedSourceError();
    if (parsed.port && parsed.port !== "443" && parsed.port !== "80") throw new UnsupportedSourceError();

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    for (const [source, domains] of Object.entries(DOMAINS) as [Source, readonly string[]][]) {
        if (domains.some((d) => matchesDomain(hostname, d))) {
            parsed.protocol = "https:";
            parsed.port = "";
            return {source, url: parsed.toString()};
        }
    }
    throw new UnsupportedSourceError();
}

// Для бота: первая ссылка в произвольном тексте сообщения.
export function findUrl(text: string): string | undefined {
    return text.match(/https?:\/\/\S+/i)?.[0];
}
