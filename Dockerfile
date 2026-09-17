# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Frontend build-time configuration (passed from deploy via --build-arg)
ARG VITE_APP_URL
ARG VITE_MERCHANT_DID
ARG VITE_API_ORIGIN

ENV VITE_APP_URL=${VITE_APP_URL} \
    VITE_MERCHANT_DID=${VITE_MERCHANT_DID} \
    VITE_API_ORIGIN=${VITE_API_ORIGIN}

COPY package.json package-lock.json turbo.json ./
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
COPY packages/shared/package.json packages/shared/
RUN npm ci
COPY packages/client packages/client
COPY packages/server packages/server
COPY packages/shared packages/shared
RUN npm run build

FROM oven/bun:1.4.0-slim
WORKDIR /app

# Litestream (Go binary) verifies TLS against the OS trust store, unlike Bun/Node which bundle
# their own CA store — without this, Litestream fails all R2 requests with
# "x509: certificate signed by unknown authority" even though the app's own R2 calls work fine.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

ARG LITESTREAM_VERSION=0.3.13
ARG TARGETARCH=amd64
ADD https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-${TARGETARCH}.tar.gz /tmp/litestream.tgz
RUN tar -xzf /tmp/litestream.tgz -C /usr/local/bin litestream && rm /tmp/litestream.tgz

COPY --from=builder /app/packages/server/dist ./dist
COPY --from=builder /app/packages/server/config ./config
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
