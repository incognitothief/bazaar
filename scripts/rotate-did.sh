#!/usr/bin/env bash
# Rotate the storefront signing key. Generates a new keypair and prints the new
# APP_MERCHANT_* environment block (incoming key becomes current; outgoing key is
# appended to APP_MERCHANT_KEY_HISTORY). See docs/adr/0013 §5.
#
#   ROTATE_KEEP_ACTIVE=1 ./scripts/rotate-did.sh   # keep the outgoing key in verificationMethod
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDIR="$ROOT/scripts"
PRIV="$SDIR/service-private.pem"
PUB="$SDIR/service-public.pem"

openssl ecparam -name prime256v1 -genkey -noout -out "$PRIV"
openssl ec -in "$PRIV" -pubout -out "$PUB"

cd "$ROOT"

# Pull the current (non-secret) key vars from packages/server/.env if the operator keeps them there.
ENV_FILE="packages/server/.env"
if [ -f "$ENV_FILE" ]; then
  for k in APP_DID APP_MERCHANT_KID APP_MERCHANT_PUBLIC_MULTIBASE APP_MERCHANT_KEY_HISTORY; do
    v="$(grep -E "^${k}=" "$ENV_FILE" | tail -1 | sed "s/^${k}=//")" || true
    [ -n "${v:-}" ] && export "${k}=${v}"
  done
fi

npx tsx scripts/rotate-did.ts "$PUB"
