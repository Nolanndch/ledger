#!/bin/bash
# Construit l'app iPhone sans projet Xcode : swiftc et le SDK iOS de Xcode (Xcode complet, pas seulement
# les outils en ligne de commande).
#   ./build.sh          → dist/Ledger-<version>-iOS.ipa, non signée : Sideloadly ou AltStore la signent
#                         avec ton identifiant Apple au moment de l'installer
#   SIM=1 ./build.sh    → build/ios/sim/Ledger.app pour le simulateur, installée et lancée sur le simulateur démarré
#   DEBUG=1             → WebView inspectable depuis Safari (Développement → Simulateur / iPhone)
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
VERSION="$(node -p 'require("../package.json").version')"
BUNDLE_ID="${BUNDLE_ID:-io.github.nolanndch.ledger}"
if [ -n "${SIM:-}" ]; then SDK_NAME=iphonesimulator; TARGET=arm64-apple-ios15.0-simulator; PLATFORM=iPhoneSimulator
else SDK_NAME=iphoneos; TARGET=arm64-apple-ios15.0; PLATFORM=iPhoneOS; fi
SDK="$(xcrun --sdk "$SDK_NAME" --show-sdk-path 2>/dev/null)" || {
  echo "SDK iOS introuvable : installe Xcode (App Store), puis : sudo xcode-select -s /Applications/Xcode.app"; exit 1; }
OUT="$ROOT/build/ios/$([ -n "${SIM:-}" ] && echo sim || echo device)"
APP="$OUT/Ledger.app"

(cd "$ROOT/android" && { [ -d node_modules ] || npm ci --silent; })
rm -rf "$OUT" && mkdir -p "$APP" "$ROOT/dist"

echo "→ Interface et moteur"
node "$ROOT/android/build-web.mjs" "$APP/www" "$ROOT/ios/web/runtime.js"

echo "→ Icône"
for s in 120:AppIcon60x60@2x 180:AppIcon60x60@3x 152:AppIcon76x76@2x; do
  sips -z "${s%%:*}" "${s%%:*}" "$ROOT/public/icons/icon-512.png" --out "$APP/${s##*:}.png" >/dev/null
done

echo "→ Code Swift"
sed -e "s/BUNDLE_ID/$BUNDLE_ID/" -e "s/VERSION/$VERSION/g" -e "s/PLATFORM/$PLATFORM/" Info.plist > "$APP/Info.plist"
plutil -convert binary1 "$APP/Info.plist"
printf 'APPL????' > "$APP/PkgInfo"
xcrun --sdk "$SDK_NAME" swiftc -sdk "$SDK" -target "$TARGET" -parse-as-library -O ${DEBUG:+-D DEBUG} \
  -module-name Ledger -o "$APP/Ledger" LedgerApp.swift
codesign -s - --force "$APP" 2>/dev/null # signature ad hoc (remplacée par celle de Sideloadly / AltStore)

if [ -n "${SIM:-}" ]; then
  xcrun simctl install booted "$APP" && xcrun simctl launch booted "$BUNDLE_ID" >/dev/null && echo "Installée et lancée sur le simulateur."
  exit 0
fi
IPA="$ROOT/dist/Ledger-$VERSION-iOS.ipa"
rm -f "$IPA" && mkdir -p "$OUT/Payload" && cp -R "$APP" "$OUT/Payload/"
(cd "$OUT" && zip -qr -X "$IPA" Payload)
echo "IPA : ${IPA#$ROOT/} ($(du -h "$IPA" | cut -f1 | tr -d ' '))"
