#!/bin/bash
# Construit Ledger.app avec son runtime Node embarqué, puis le zip à publier.
#   bash mac/build.sh              architecture de la machine (arm64 ou x64)
#   ARCH=x64 bash mac/build.sh     Mac Intel
# Sortie : dist/<arch>/Ledger.app et dist/Ledger-<version>-macOS-<arch>.zip
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)
NODE_VERSION=${NODE_VERSION:-24.21.0}
BUNDLE_ID=${BUNDLE_ID:-io.github.nolanndch.ledger}
REPO_URL=${REPO_URL:-https://github.com/Nolanndch/ledger}
ARCH=${ARCH:-$(uname -m)}
[ "$ARCH" = "x86_64" ] && ARCH=x64
# Intel : macOS 13 minimum, la chaîne d'outils récente n'a plus les bibliothèques de compatibilité x86_64 pour macOS 12.
case "$ARCH" in arm64) MIN_OS=12.0 ;; x64) MIN_OS=13.0 ;; *) echo "ARCH inconnue : $ARCH"; exit 1 ;; esac
TARGET="$([ "$ARCH" = x64 ] && echo x86_64 || echo arm64)-apple-macos$MIN_OS"

BUILD=build
OUT="dist/$ARCH"
APP="$OUT/Ledger.app"
mkdir -p "$BUILD" "$OUT"

echo "→ Runtime Node $NODE_VERSION ($ARCH)"
TARBALL="node-v$NODE_VERSION-darwin-$ARCH.tar.gz"
if [ ! -f "$BUILD/$TARBALL" ]; then
  curl -fL --progress-bar -o "$BUILD/$TARBALL.part" "https://nodejs.org/dist/v$NODE_VERSION/$TARBALL"
  mv "$BUILD/$TARBALL.part" "$BUILD/$TARBALL"
fi
EXPECTED=$(curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" | awk -v f="$TARBALL" '$2 == f { print $1 }')
ACTUAL=$(shasum -a 256 "$BUILD/$TARBALL" | awk '{ print $1 }')
[ -n "$EXPECTED" ] && [ "$EXPECTED" = "$ACTUAL" ] || { echo "Somme de contrôle Node invalide"; rm -f "$BUILD/$TARBALL"; exit 1; }
rm -rf "$BUILD/node-$ARCH" && mkdir -p "$BUILD/node-$ARCH"
tar -xzf "$BUILD/$TARBALL" -C "$BUILD/node-$ARCH" --strip-components 2 "node-v$NODE_VERSION-darwin-$ARCH/bin/node"

echo "→ Icône"
if [ ! -f "$BUILD/Ledger.icns" ] || [ mac/make-icon.swift -nt "$BUILD/Ledger.icns" ]; then
  swift mac/make-icon.swift "$BUILD/icon-1024.png" >/dev/null
  rm -rf "$BUILD/Ledger.iconset" && mkdir "$BUILD/Ledger.iconset"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$BUILD/icon-1024.png" --out "$BUILD/Ledger.iconset/icon_${s}x${s}.png" >/dev/null
    sips -z $((s * 2)) $((s * 2)) "$BUILD/icon-1024.png" --out "$BUILD/Ledger.iconset/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns -o "$BUILD/Ledger.icns" "$BUILD/Ledger.iconset"
fi

echo "→ Compilation ($TARGET)"
swiftc -O -swift-version 5 -target "$TARGET" mac/LedgerApp.swift -o "$BUILD/Ledger-$ARCH"

echo "→ Assemblage"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/app" "$APP/Contents/Resources/runtime"
cp "$BUILD/Ledger-$ARCH" "$APP/Contents/MacOS/Ledger"
sed -e "s|__VERSION__|$VERSION|g" -e "s|__MIN_OS__|$MIN_OS|g" -e "s|__BUNDLE_ID__|$BUNDLE_ID|g" -e "s|__REPO_URL__|$REPO_URL|g" mac/Info.plist > "$APP/Contents/Info.plist"
cp "$BUILD/Ledger.icns" "$APP/Contents/Resources/Ledger.icns"
cp server.mjs package.json "$APP/Contents/Resources/app/"
rsync -a --exclude .DS_Store public/ "$APP/Contents/Resources/app/public/"
cp "$BUILD/node-$ARCH/node" "$APP/Contents/Resources/runtime/node"

echo "→ Signature ad hoc"
# Le binaire node garde la signature officielle de Node.js ; on signe l'exécutable et le bundle.
codesign --force --sign - "$APP/Contents/MacOS/Ledger"
codesign --force --sign - "$APP"

ZIP="dist/Ledger-$VERSION-macOS-$ARCH.zip"
rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"
echo "✓ $APP"
echo "✓ $ZIP ($(du -h "$ZIP" | cut -f1))"
