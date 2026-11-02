#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOD_NAME="herdr-app-notifier"
APP_HOME="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
HERDR_APP_BUNDLE="${HERDR_APP_BUNDLE:-/Applications/Herdr.app}"
HERDR_ICON="$HERDR_APP_BUNDLE/Contents/Resources/Herdr.icns"
TARGET="$APP_HOME/mods/$MOD_NAME"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/herdr-app-notifier-install.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Herdr App Notifier currently supports macOS only." >&2
  exit 1
fi
if [[ -e "$TARGET" ]]; then
  printf 'The mod already exists at %s. Refusing to overwrite it.\n' "$TARGET" >&2
  echo "Back it up or move it aside before reinstalling." >&2
  exit 1
fi
if ! command -v swiftc >/dev/null 2>&1 || ! command -v xcrun >/dev/null 2>&1; then
  echo "Swift and the macOS SDK are required to build the native helper." >&2
  echo "Install Apple's Command Line Tools with: xcode-select --install" >&2
  exit 1
fi
if [[ ! -f "$HERDR_ICON" ]]; then
  printf 'Herdr app icon not found: %s\n' "$HERDR_ICON" >&2
  echo "Set HERDR_APP_BUNDLE to the path of Herdr.app and retry." >&2
  exit 1
fi

"$ROOT/scripts/build-native.sh" "$TMP/HerdrNotifier.app" "$HERDR_ICON"
mkdir -p "$APP_HOME/mods"
ditto "$ROOT/mod" "$TARGET"
ditto "$TMP/HerdrNotifier.app" "$TARGET/HerdrNotifier.app"

LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [[ -x "$LSREGISTER" ]]; then
  "$LSREGISTER" -f "$TARGET/HerdrNotifier.app" >/dev/null 2>&1
fi

if command -v herdr-app >/dev/null 2>&1; then
  herdr-app check "$TARGET"
else
  echo "herdr-app is not on PATH; run 'herdr-app check $TARGET' after installing Herdr App."
fi

echo "Installed Herdr App Notifier at: $TARGET"
echo "If its panel is not visible, run: herdr-app do mod.open --name $MOD_NAME"
echo "Allow Herdr App Notifier under System Settings → Notifications to see banners."
