#!/usr/bin/env bash
# Generates scripts/service-{private,public}.pem and prints the STOREFRONT_* block to set.
#
# Usage: ./scripts/gen-did.sh [your-store-domain | did:web:...]
#   The storefront DID must name the host that serves /.well-known/did.json. If no domain is
#   given, STOREFRONT_DID from packages/server/.env is used; failing that the script warns and
#   falls back to the reference deployment's DID, which is not yours.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDIR="$ROOT/scripts"
PRIV="$SDIR/service-private.pem"
PUB="$SDIR/service-public.pem"

openssl ecparam -name prime256v1 -genkey -noout -out "$PRIV"
openssl ec -in "$PRIV" -pubout -out "$PUB"

cd "$ROOT"

# Same as rotate-did.sh: pick up the non-secret key vars if the operator keeps them here.
ENV_FILE="packages/server/.env"
if [ -f "$ENV_FILE" ]; then
  v="$(grep -E "^STOREFRONT_DID=" "$ENV_FILE" | tail -1 | sed "s/^STOREFRONT_DID=//")" || true
  [ -n "${v:-}" ] && export "STOREFRONT_DID=${v}"
fi

npx tsx scripts/gen-did.ts "$PUB" "${1:-}"
