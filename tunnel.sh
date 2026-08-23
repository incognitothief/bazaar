#!/usr/bin/env bash
set -euo pipefail

echo "Once cloudflared prints the https://….trycloudflare.com URL, restart the app with:"
echo "  make dev CLOUDFLARED_URL=<that-url>"
echo

exec cloudflared tunnel --url http://127.0.0.1:5173
