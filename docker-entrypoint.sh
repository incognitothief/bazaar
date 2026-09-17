#!/bin/sh
set -e
mkdir -p "$(dirname "$DATABASE_PATH")"

if [ -n "${R2_BUCKET:-}" ] && [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_SECRET_ACCESS_KEY:-}" ] && [ -n "${R2_ENDPOINT:-}" ]; then
  # A blank volume (first boot, a lost volume, a renamed mount) has to be refilled from R2 BEFORE
  # the server starts: index.ts creates the DB file and runs migrate() against it, so once Bun is
  # up there is nothing left to restore into. Without this the app comes up healthy but empty,
  # Litestream starts a fresh generation, and the retention in litestream.yml expires the last
  # good one — the whole failure is silent, which is what the echoes below are for.
  #   -if-db-not-exists   no-op when the volume already holds the DB (every normal boot)
  #   -if-replica-exists  no-op when the bucket is empty (a genuinely new deployment)
  # Both are required: `set -e` means an unguarded restore kills the container in either case.
  if [ ! -f "$DATABASE_PATH" ]; then
    echo "litestream: $DATABASE_PATH missing, attempting restore from R2"
    litestream restore -if-db-not-exists -if-replica-exists -config /app/litestream.yml "$DATABASE_PATH"
    if [ -f "$DATABASE_PATH" ]; then
      echo "litestream: restored $DATABASE_PATH from R2"
    else
      echo "litestream: no replica in R2, starting with an empty database"
    fi
  fi

  exec litestream replicate -config /app/litestream.yml -exec "bun /app/dist/index.js"
fi

exec bun /app/dist/index.js
