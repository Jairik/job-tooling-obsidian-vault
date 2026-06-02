#!/usr/bin/env bash
# One-command launcher for Vault Assistant.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required. Install it from https://bun.sh and re-run." >&2
  exit 1
fi

# Load .env if present (for VAULT_DIR / PORT)
if [ -f .env ]; then set -a; . ./.env; set +a; fi

echo "Installing dependencies..."
bun install

PORT="${PORT:-5173}"
echo ""
echo "Vault Assistant starting on http://localhost:${PORT}"
echo "Press Ctrl+C to stop."
echo ""
exec bun --hot server.ts
