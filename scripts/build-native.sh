#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_APP="${1:?Usage: build-native.sh OUTPUT.app HERDR_ICON.icns}"
HERDR_ICON="${2:?Usage: build-native.sh OUTPUT.app HERDR_ICON.icns}"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/herdr-notifier-build.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

if [[ -e "$OUTPUT_APP" ]]; then
  printf 'Refusing to overwrite existing output: %s\n' "$OUTPUT_APP" >&2
  exit 1
fi
if [[ ! -f "$HERDR_ICON" ]]; then
  printf 'Herdr icon not found: %s\n' "$HERDR_ICON" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_APP")"
for arch in arm64 x86_64; do
  swiftc \
    -O \
    -parse-as-library \
    -target "${arch}-apple-macosx13.0" \
    -sdk "$SDK" \
    -framework AppKit \
    "$ROOT/native/HerdrNotifier.swift" \
    -o "$TMP/HerdrNotifier-${arch}"
done

mkdir -p "$OUTPUT_APP/Contents/MacOS" "$OUTPUT_APP/Contents/Resources"
cp "$ROOT/native/Info.plist" "$OUTPUT_APP/Contents/Info.plist"
cp "$HERDR_ICON" "$OUTPUT_APP/Contents/Resources/Herdr.icns"
lipo -create \
  "$TMP/HerdrNotifier-arm64" \
  "$TMP/HerdrNotifier-x86_64" \
  -output "$OUTPUT_APP/Contents/MacOS/HerdrNotifier"
chmod 755 "$OUTPUT_APP/Contents/MacOS/HerdrNotifier"
codesign --force --deep --sign - "$OUTPUT_APP"
codesign --verify --deep --strict "$OUTPUT_APP"

printf 'Built and signed: %s\n' "$OUTPUT_APP"
file "$OUTPUT_APP/Contents/MacOS/HerdrNotifier"
