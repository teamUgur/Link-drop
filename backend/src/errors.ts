export type ErrorDetail = { path: string; message: string };

export class AppError extends Error {
    readonly code: string;
    readonly statusCode: number;
    readonly details: ErrorDetail[] | undefined;

    constructor(code: string, statusCode: number, message: string, details?: ErrorDetail[], options?: ErrorOptions) {
        super(message, options);
        this.name = new.target.name;
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
    }
}

export class ValidationError extends AppError {
    constructor(details: ErrorDetail[]) {
        super("VALIDATION_ERROR", 400, "Некорректный запрос", details);
    }
}

export class UnsupportedSourceError extends AppError {
    constructor() {
        super("UNSUPPORTED_SOURCE", 422, "Поддерживаются только ссылки YouTube, Instagram и TikTok");
    }
}

export class MediaUnavailableError extends AppError {
    constructor(message = "Видео недоступно: приватное, удалено или закрыто в вашем регионе", options?: ErrorOptions) {
        super("MEDIA_UNAVAILABLE", 422, message, undefined, options);
    }
}

export class FormatUnavailableError extends AppError {
    constructor() {
        super("FORMAT_UNAVAILABLE", 422, "Этот формат недоступен для видео");
    }
}

export class TooLargeError extends AppError {
    constructor(message: string) {
        super("TOO_LARGE", 422, message);
    }
}

export class BusyError extends AppError {
    readonly retryAfterSec: number;

    constructor(retryAfterSec: number) {
        super("BUSY", 503, "Сервер сейчас занят, попробуйте через минуту");
        this.retryAfterSec = retryAfterSec;
    }
}

export class DownloadInProgressError extends AppError {
    constructor() {
        super("DOWNLOAD_IN_PROGRESS", 429, "У вас уже идёт загрузка — дождитесь, пока она закончится");
    }
}

export class NetworkDownloadsLimitError extends AppError {
    constructor() {
        super("NETWORK_DOWNLOADS_LIMIT", 429, "Из вашей сети уже идёт несколько загрузок — попробуйте через минуту");
    }
}

export class UpstreamTimeoutError extends AppError {
    constructor() {
        super("UPSTREAM_TIMEOUT", 504, "Платформа слишком долго отвечает, попробуйте позже");
    }
}

// Отдельно от INTERNAL_ERROR: «yt-dlp не справился с платформой» лечится обновлением yt-dlp
// или ожиданием, а не правкой нашего кода — на дашборде это должно различаться.
export class UpstreamError extends AppError {
    constructor(options?: ErrorOptions) {
        super("UPSTREAM_ERROR", 502, "Не удалось получить видео с платформы, попробуйте позже", undefined, options);
    }
}

export class FileExpiredError extends AppError {
    constructor() {
        super("FILE_EXPIRED", 404, "Файл уже скачан или ссылка устарела — подготовьте его заново");
    }
}

export class InternalError extends AppError {
    constructor() {
        super("INTERNAL_ERROR", 500, "Внутренняя ошибка сервера");
    }
}

export type ErrorBody = { error: { code: string; message: string; details?: ErrorDetail[] | undefined } };

// Один формат и для обычного ответа, и для события ошибки внутри потока prepare.
export function errorBody(error: AppError): ErrorBody {
    return {error: {code: error.code, message: error.message, details: error.details}};
}

export class DownloadAbortedError extends Error {
    constructor() {
        super("Download aborted by caller");
        this.name = "DownloadAbortedError";
    }
}
