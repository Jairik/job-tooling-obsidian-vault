#!/usr/bin/env bash
# Repairs a Tauri-built AppImage whose bun-compiled binaries were corrupted by
# linuxdeploy: it rpath-patches (patchelf) and strips every ELF in the AppDir,
# which breaks the bun sidecar and the claude SDK CLI shipped in resources.
# Building with PATCHELF=<system patchelf> lets bundling complete, but the
# output is still broken at runtime — so this script extracts the AppImage,
# restores pristine copies of the two bun-compiled ELFs, verifies them, and
# repacks with appimagetool. The main vault-assistant binary and bundled libs
# keep linuxdeploy's (correct) patches.
#
# Note on layout: tauri's Linux bundlers flatten the `app/**/*` resources glob
# into `usr/lib/Vault Assistant/app/` (same data generation as the deb), so the
# SDK CLI lands at `app/claude`, not under its node_modules path.
#
# Usage: repair-appimage.sh <path/to/App.AppImage>
set -euo pipefail

APPIMAGE="$(realpath "$1")"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"   # repo root
TRIPLE="$(rustc -Vv | awk '/^host:/ { print $2 }')"
ARCH_ID="${TRIPLE%%-*}"                       # e.g. x86_64
PRISTINE_BUN="$ROOT/src-tauri/binaries/bun-${TRIPLE}"
# The AppImage leg only runs on x86_64 glibc Linux, so the SDK package is fixed.
PRISTINE_CLAUDE="$ROOT/src-tauri/app/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude"

[ -f "$PRISTINE_BUN" ] || { echo "error: pristine sidecar missing: $PRISTINE_BUN" >&2; exit 1; }
[ -f "$PRISTINE_CLAUDE" ] || { echo "error: pristine SDK CLI missing: $PRISTINE_CLAUDE" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

# --appimage-extract is handled by the AppImage runtime itself; no FUSE needed.
"$APPIMAGE" --appimage-extract >/dev/null
APPDIR="$WORK/squashfs-root"
RES_APP="$APPDIR/usr/lib/Vault Assistant/app"
BUNDLED_BUN="$APPDIR/usr/bin/bun"
BUNDLED_CLAUDE="$RES_APP/claude"

if [ ! -f "$BUNDLED_BUN" ] || [ ! -f "$BUNDLED_CLAUDE" ]; then
  echo "error: expected $BUNDLED_BUN and $BUNDLED_CLAUDE — AppDir layout changed?" >&2
  find "$APPDIR" -maxdepth 4 >&2
  exit 1
fi

# If a future change ships additional ELF resources, linuxdeploy corrupted
# those too and this script must learn about them — fail instead of shipping.
EXTRA_ELF="$(find "$RES_APP" -type f | while read -r f; do
  [ "$f" = "$BUNDLED_CLAUDE" ] && continue
  head -c4 "$f" | grep -q $'\x7fELF' && echo "$f"
done || true)"
if [ -n "$EXTRA_ELF" ]; then
  echo "error: unexpected ELF resources (also patchelf-corrupted):" >&2
  echo "$EXTRA_ELF" >&2
  exit 1
fi

# Restore pristine binaries over the patchelf/strip-mangled copies.
install -m 755 "$PRISTINE_BUN" "$BUNDLED_BUN"
install -m 755 "$PRISTINE_CLAUDE" "$BUNDLED_CLAUDE"

# Verify: restored files are byte-identical to pristine and actually execute.
cmp "$BUNDLED_BUN" "$PRISTINE_BUN"
cmp "$BUNDLED_CLAUDE" "$PRISTINE_CLAUDE"
"$BUNDLED_BUN" --version
"$BUNDLED_CLAUDE" --version

# Repack. Prefer an appimagetool Tauri already cached; download otherwise.
APPIMAGETOOL="${APPIMAGETOOL:-}"
if [ -z "$APPIMAGETOOL" ]; then
  for cached in "$HOME/.cache/tauri/appimagetool-${ARCH_ID}.AppImage" "$HOME/.cache/tauri/appimagetool"; do
    if [ -x "$cached" ]; then APPIMAGETOOL="$cached"; break; fi
  done
fi
if [ -z "$APPIMAGETOOL" ]; then
  APPIMAGETOOL="$WORK/appimagetool"
  curl -fsSL -o "$APPIMAGETOOL" \
    "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-${ARCH_ID}.AppImage"
  chmod +x "$APPIMAGETOOL"
fi

# --appimage-extract-and-run: CI runners have no FUSE for running AppImages.
ARCH="$ARCH_ID" "$APPIMAGETOOL" --appimage-extract-and-run "$APPDIR" "$WORK/repaired.AppImage"
mv -f "$WORK/repaired.AppImage" "$APPIMAGE"
echo "Repaired AppImage: $APPIMAGE"
