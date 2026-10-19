# syntax=docker/dockerfile:1

# Версия yt-dlp закреплена вместе с SHA256: образ собирается одинаково, а подмена релиза
# ломает сборку, а не прод. Обновление = поменять три ARG (суммы из SHA2-256SUMS релиза).
ARG NODE_IMAGE=node:24.19-trixie-slim
ARG YTDLP_VERSION=2026.08.19
ARG YTDLP_SHA256_AMD64=32e72032766bef9199d99d15beb69fd52e46df8f8b06f0d8745db59e04d339e9
ARG YTDLP_SHA256_ARM64=4e27ad43f3a34bacffd078694eb3edbb4e3b378e7da44edab2be02e98555516e

# Берём onedir-сборку (`yt-dlp_linux.zip`), а не однофайловую: однофайловый PyInstaller на
# каждом запуске распаковывает ~90 МБ во /tmp — это секунда к каждому resolve и мусор при kill -9.
# pip-установка отвергнута: тянет Python в рантайм-образ и версии зависимостей не закреплены.
FROM debian:trixie-slim AS ytdlp
ARG TARGETARCH
ARG YTDLP_VERSION
ARG YTDLP_SHA256_AMD64
ARG YTDLP_SHA256_ARM64
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) asset=yt-dlp_linux.zip; sum="$YTDLP_SHA256_AMD64"; bin=yt-dlp_linux ;; \
      arm64) asset=yt-dlp_linux_aarch64.zip; sum="$YTDLP_SHA256_ARM64"; bin=yt-dlp_linux_aarch64 ;; \
      *) echo "unsupported arch: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/yt-dlp.zip "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/${asset}"; \
    echo "${sum}  /tmp/yt-dlp.zip" | sha256sum -c -; \
    unzip -q /tmp/yt-dlp.zip -d /opt/yt-dlp; \
    mv "/opt/yt-dlp/${bin}" /opt/yt-dlp/yt-dlp; \
    chmod 0755 /opt/yt-dlp/yt-dlp

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM ${NODE_IMAGE}
# ffmpeg из apt, а не статическая сборка: обновляется вместе с базовым образом, версия yt-dlp
# не требует свежее, чем в Debian stable.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ytdlp /opt/yt-dlp /opt/yt-dlp
# Без симлинка в /usr/local/bin: onedir-сборка ищет `_internal/` рядом с исполняемым файлом.
# Каталог под TEMP_DIR создаём с владельцем node: пустой named volume при первом монтировании
# наследует владельца, иначе он root и процесс без root не сможет писать.
RUN mkdir -p /var/tmp/linkdrop && chown node:node /var/tmp/linkdrop

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Кеш yt-dlp (плеер YouTube, решения JS-челленджа) — на томе TEMP_DIR: корень образа read-only,
# а без кеша каждый resolve YouTube заново качает и разбирает плеер. cleanTempRoot трогает только job-*.
ENV NODE_ENV=production \
    XDG_CACHE_HOME=/var/tmp/linkdrop/.cache \
    HOST=0.0.0.0 \
    PORT=3000 \
    TEMP_DIR=/var/tmp/linkdrop \
    YTDLP_PATH=/opt/yt-dlp/yt-dlp
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Node напрямую, без npm start: npm не пробрасывает SIGTERM, и graceful shutdown не срабатывает.
CMD ["node", "src/server.ts"]
