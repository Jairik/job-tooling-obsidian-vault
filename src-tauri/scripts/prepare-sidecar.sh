#!/usr/bin/env bash
# Copies the host `bun` executable to the target-triple name Tauri expects for an
# externalBin sidecar (binaries/bun-<triple>). Runs before both `tauri dev` and
# `tauri build`. To cross-build for another OS/arch, drop that platform's bun
# binary at binaries/bun-<that-triple> before bundling.
set -euo pipefail
cd "$(dirname "$0")/.."   # -> src-tauri

TRIPLE="$(rustc -Vv | awk '/^host:/ { print $2 }')"

BUN="$(command -v bun || true)"
if [ -z "$BUN" ]; then
  echo "error: bun not found on PATH — install it from https://bun.sh" >&2
  exit 1
fi

mkdir -p binaries
cp -f "$BUN" "binaries/bun-${TRIPLE}"
chmod +x "binaries/bun-${TRIPLE}"
echo "Prepared sidecar: binaries/bun-${TRIPLE}"

# The tauri.conf.json `resources` glob (app/**/*) is validated at compile time, but
# the real app tree is only staged by stage-app.sh for `tauri build`. In dev the
# server runs from the repo root, so a placeholder is enough to satisfy the glob.
mkdir -p app
[ -e app/.keep ] || touch app/.keep

