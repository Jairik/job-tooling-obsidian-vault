#!/usr/bin/env bash
# One-command launcher for Vault Assistant.
set -euo pipefail
# Resolve the directory of this script, resolving symlinks
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  DIR="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
DIR="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required. Install it from https://bun.sh and re-run." >&2
  exit 1
fi

# Load .env if present (for VAULT_DIR / PORT)
if [ -f .env ]; then set -a; . ./.env; set +a; fi

PORT="${PORT:-5173}"
export PORT

if [ "${1:-}" = "--tui" ]; then
  shift
  if [ ! -d node_modules ]; then
    echo "Installing dependencies..."
    bun install
    echo ""
  fi
  echo "Vault Assistant TUI starting..."
  echo ""
  exec bun run tui -- "$@"
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  bun install
  echo ""
fi

echo "Vault Assistant starting on http://localhost:${PORT}"
echo "Press Ctrl+C to stop."
echo ""
exec bun --hot server.ts
