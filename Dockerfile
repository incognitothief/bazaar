# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json turbo.json ./
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
RUN npm ci
COPY packages/client packages/client
COPY packages/server packages/server
RUN npm run build

FROM oven/bun:1-slim
WORKDIR /app

ARG LITESTREAM_VERSION=0.3.13
ARG TARGETARCH=amd64
ADD https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-${TARGETARCH}.tar.gz /tmp/litestream.tgz
RUN tar -xzf /tmp/litestream.tgz -C /usr/local/bin litestream && rm /tmp/litestream.tgz

COPY --from=builder /app/packages/server/dist ./dist
COPY --from=builder /app/packages/server/drizzle ./drizzle
COPY --from=builder /app/packages/client/dist ./static
COPY docker-entrypoint.sh litestream.yml ./
RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/app.db \
    STATIC_ROOT=/app/static \
    MIGRATIONS_FOLDER=/app/drizzle

EXPOSE 3000
VOLUME ["/data"]
ENTRYPOINT ["./docker-entrypoint.sh"]
