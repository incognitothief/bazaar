#!/bin/sh
set -e
mkdir -p "$(dirname "$DATABASE_PATH")"

if [ -n "${R2_BUCKET:-}" ] && [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_SECRET_ACCESS_KEY:-}" ] && [ -n "${R2_ENDPOINT:-}" ]; then
  exec litestream replicate -config /app/litestream.yml -exec "bun /app/dist/index.js"
fi

exec bun /app/dist/index.js
