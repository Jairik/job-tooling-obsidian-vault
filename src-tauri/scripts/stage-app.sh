#!/usr/bin/env bash
# Stages a bundled Bun server plus the few runtime packages that cannot be safely
# bundled into src-tauri/app so Tauri can ship them as resources. Only needed for
# `tauri build`; `tauri dev` runs the server straight from the repo root.
set -euo pipefail
cd "$(dirname "$0")/.."          # -> src-tauri
ROOT="$(cd .. && pwd)"           # repo root
DEST="app"
ROOT_NODE_MODULES="$ROOT/node_modules"

rm -rf "$DEST"
mkdir -p "$DEST"

if [ ! -d "$ROOT_NODE_MODULES" ]; then
  ( cd "$ROOT" && (bun install --frozen-lockfile || bun install) )
fi

bun build "$ROOT/server.ts" \
  --target=bun \
  --production \
  --outdir "$DEST" \
  --sourcemap=none \
  --external playwright \
  --external css-tree

copy_node_module() {
  local name="$1"
  local src="$ROOT_NODE_MODULES/$name"
  local out="$DEST/node_modules/$name"

  if [ ! -e "$src" ]; then
    echo "error: required runtime package missing from node_modules: $name" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$out")"
  cp -R "$src" "$out"
}

select_claude_sdk_package() {
  bun -e '
const platform = process.platform;
const arch = process.arch;
const isMusl = platform === "linux" && process.report?.getReport?.().header?.glibcVersionRuntime === undefined;

if (platform === "linux") {
  console.log(`@anthropic-ai/claude-agent-sdk-linux-${arch}${isMusl ? "-musl" : ""}`);
} else if (platform === "darwin") {
  console.log(`@anthropic-ai/claude-agent-sdk-darwin-${arch}`);
} else {
  console.error(`Unsupported Claude Agent SDK platform: ${platform}-${arch}`);
  process.exit(1);
}
'
}

# Externalized because css-tree loads JSON data through createRequire at runtime.
for pkg in css-tree mdn-data source-map-js; do
  copy_node_module "$pkg"
done

# Externalized because Playwright performs runtime resolution/spawning for its
# browser driver. Chromium itself remains an opt-in host dependency.
for pkg in playwright playwright-core; do
  copy_node_module "$pkg"
done

# The SDK JS is bundled, but it resolves a native Claude Code subprocess from an
# optional platform package. Copy only the matching package instead of glibc+musl
# or every OS/arch variant.
copy_node_module "$(select_claude_sdk_package)"

echo "Staged app resources into src-tauri/$DEST"
