#!/bin/bash
# Construit la version Windows (x64) depuis un Mac ou Linux : Ledger.exe + runtime Node + interface, dans un zip portable.
#   bash windows/build.sh
# Sortie : dist/windows/Ledger/ et dist/Ledger-<version>-Windows-x64.zip
# Prérequis : Go (brew install go). L'icône est générée par mac/make-icon.swift (Mac) si build/icon-1024.png manque.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)
NODE_VERSION=${NODE_VERSION:-24.21.0}
BUILD=build
OUT=dist/windows/Ledger
mkdir -p "$BUILD"

echo "→ Runtime Node $NODE_VERSION (win-x64)"
ZIPNAME="node-v$NODE_VERSION-win-x64.zip"
if [ ! -f "$BUILD/$ZIPNAME" ]; then
  curl -fL --progress-bar -o "$BUILD/$ZIPNAME.part" "https://nodejs.org/dist/v$NODE_VERSION/$ZIPNAME"
  mv "$BUILD/$ZIPNAME.part" "$BUILD/$ZIPNAME"
fi
EXPECTED=$(curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" | awk -v f="$ZIPNAME" '$2 == f { print $1 }')
ACTUAL=$(shasum -a 256 "$BUILD/$ZIPNAME" | awk '{ print $1 }')
[ -n "$EXPECTED" ] && [ "$EXPECTED" = "$ACTUAL" ] || { echo "Somme de contrôle Node invalide"; rm -f "$BUILD/$ZIPNAME"; exit 1; }
rm -rf "$BUILD/node-win" && mkdir -p "$BUILD/node-win"
unzip -q -j "$BUILD/$ZIPNAME" "node-v$NODE_VERSION-win-x64/node.exe" -d "$BUILD/node-win"

echo "→ Icône et métadonnées de l'exécutable"
[ -f "$BUILD/icon-1024.png" ] || swift mac/make-icon.swift "$BUILD/icon-1024.png" >/dev/null
sips -z 256 256 "$BUILD/icon-1024.png" --out "$BUILD/icon-256.png" >/dev/null 2>&1 || cp "$BUILD/icon-1024.png" "$BUILD/icon-256.png"
(cd windows && go run github.com/tc-hib/go-winres@v0.3.3 simply --arch amd64 --manifest gui --icon "../$BUILD/icon-256.png" \
  --product-name Ledger --file-description Ledger --original-filename Ledger.exe --copyright "Licence MIT" \
  --product-version "$VERSION" --file-version "$VERSION" --out rsrc)

echo "→ Compilation du lanceur"
rm -rf dist/windows && mkdir -p "$OUT/app" "$OUT/runtime"
(cd windows && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-H=windowsgui -s -w" -o "../$OUT/Ledger.exe" .)
rm -f windows/rsrc_windows_*.syso

echo "→ Assemblage"
cp server.mjs package.json "$OUT/app/"
rsync -a server/ "$OUT/app/server/"
rsync -a --exclude .DS_Store --exclude sw.js public/ "$OUT/app/public/"
cp "$BUILD/node-win/node.exe" "$OUT/runtime/node.exe"
cat > "$OUT/LISEZMOI.txt" <<EOF
Ledger $VERSION pour Windows

1. Garde ce dossier où tu veux (par exemple dans Documents) et double-clique sur Ledger.exe.
2. Si Windows affiche "Windows a protégé votre ordinateur", clique sur "Informations complémentaires" puis "Exécuter quand même".
   L'application n'est pas signée par un éditeur payant, c'est normal.
3. Pour l'avoir sous la main : clic droit sur Ledger.exe > Épingler au menu Démarrer.

Tes données sont dans %APPDATA%\\Ledger (base ledger.db, sauvegardes quotidiennes dans backups).
Supprimer ce dossier ne supprime pas tes données.
EOF

ZIP="dist/Ledger-$VERSION-Windows-x64.zip"
rm -f "$ZIP"
(cd dist/windows && zip -qr -X "../$(basename "$ZIP")" Ledger)
echo "✓ $OUT"
echo "✓ $ZIP ($(du -h "$ZIP" | cut -f1))"
