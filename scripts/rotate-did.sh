#!/usr/bin/env bash
# Rotate the storefront signing key. Generates a new keypair and prints the new
# STOREFRONT_* environment block (incoming key becomes current; outgoing key is
# appended to STOREFRONT_KEY_HISTORY as retired). See docs/adr/0013 §5.
# To hard-revoke a key, add "revoked": true to its keyHistory entry by hand.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDIR="$ROOT/scripts"
PRIV="$SDIR/service-private.pem"
PUB="$SDIR/service-public.pem"

cd "$ROOT"

# Pull the current (non-secret) key vars from packages/server/.env if the operator keeps them there.
ENV_FILE="packages/server/.env"
if [ -f "$ENV_FILE" ]; then
  for k in STOREFRONT_DID STOREFRONT_KID STOREFRONT_PUBLIC_MULTIBASE STOREFRONT_KEY_HISTORY; do
    v="$(grep -E "^${k}=" "$ENV_FILE" | tail -1 | sed "s/^${k}=//")" || true
    [ -n "${v:-}" ] && export "${k}=${v}"
  done
fi

# Check preconditions BEFORE generating anything. rotate-did.ts needs the *current* key's kid
# and multibase; if they are missing it tells you to derive the multibase from the current
# public pem -- which only works while that file still exists.
if [ -z "${STOREFRONT_KID:-}" ] || [ -z "${STOREFRONT_PUBLIC_MULTIBASE:-}" ]; then
  echo "rotate-did: STOREFRONT_KID and STOREFRONT_PUBLIC_MULTIBASE must be set to the CURRENT key." >&2
  echo "            Set them in $ENV_FILE or the environment and re-run." >&2
  if [ -f "$PUB" ]; then
    echo "            To derive the multibase from the current public key:" >&2
    echo "              npx tsx scripts/gen-pub-key.ts $PUB" >&2
  fi
  exit 1
fi

# Never overwrite key material in place -- a rotation that fails halfway would otherwise
# destroy the only copy of the key currently signing receipts.
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
for f in "$PRIV" "$PUB"; do
  if [ -f "$f" ]; then
    mv "$f" "$f.$STAMP.bak"
    echo "rotate-did: existing $(basename "$f") saved as $(basename "$f").$STAMP.bak" >&2
  fi
done

openssl ecparam -name prime256v1 -genkey -noout -out "$PRIV"
openssl ec -in "$PRIV" -pubout -out "$PUB"

npx tsx scripts/rotate-did.ts "$PUB"
