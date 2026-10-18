# syntax=docker/dockerfile:1

# Фронт собирается внутрь образа Caddy: статика и раздающий её сервер версионируются вместе,
# на VPS не нужен ни Node, ни отдельный шаг «скопировать dist/».
FROM node:24.19-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
# Vite вшивает VITE_* в бандл на этапе сборки, поэтому ссылка на бота — аргумент сборки, а не env рантайма.
ARG VITE_MAX_BOT_URL=
ENV VITE_MAX_BOT_URL=${VITE_MAX_BOT_URL}
RUN npm run build

FROM caddy:2.11.7-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
