#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDIR="$ROOT/scripts"
PRIV="$SDIR/service-private.pem"
PUB="$SDIR/service-public.pem"

openssl ecparam -name prime256v1 -genkey -noout -out "$PRIV"
openssl ec -in "$PRIV" -pubout -out "$PUB"

cd "$ROOT"
npx tsx scripts/gen-pub-key.ts "$PUB"
npx tsx scripts/gen-did.ts "$PUB"
