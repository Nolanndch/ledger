#!/bin/bash
# Construit l'app Android (APK) sans Gradle : outils du SDK Android (aapt2, d8, apksigner) et Java d'Android Studio.
#   ./build.sh            → dist/Ledger-<version>.apk
#   DEBUG=1 ./build.sh    → app débogable (inspection de la WebView depuis chrome://inspect)
#   INSTALL=1 ./build.sh  → installe aussi sur le téléphone branché en USB (adb)
# La clé de signature est créée au premier build dans ~/.android/ledger-release.jks (à garder : les mises à jour
# de l'app doivent être signées avec la même clé).
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BT="$(ls -d "$SDK"/build-tools/*/ | sort -V | tail -1)"
JAR="$SDK/platforms/android-36/android.jar"
[ -f "$JAR" ] || JAR="$(ls "$SDK"/platforms/android-3[4-9]/android.jar | sort -V | tail -1)"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export PATH="$JAVA_HOME/bin:$PATH"
OUT="$ROOT/build/android"
VERSION="$(node -p 'require("../package.json").version')"
CODE="$(node -p 'const [a,b,c]=require("../package.json").version.split(".").map(Number); a*10000+b*100+c')"
KS="${LEDGER_KEYSTORE:-$HOME/.android/ledger-release.jks}"

[ -d node_modules ] || npm ci --silent
rm -rf "$OUT" && mkdir -p "$OUT/res" "$OUT/classes" "$OUT/dex" "$ROOT/dist"

echo "→ Interface et moteur"
node build-web.mjs "$OUT/assets/www"

echo "→ Ressources"
cp -R res "$OUT/res-src"
for d in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  mkdir -p "$OUT/res-src/mipmap-${d%%:*}"
  sips -z "${d##*:}" "${d##*:}" "$ROOT/public/icons/icon-512.png" --out "$OUT/res-src/mipmap-${d%%:*}/ic_launcher.png" >/dev/null
done
"$BT/aapt2" compile --dir "$OUT/res-src" -o "$OUT/res.zip"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$JAR" --manifest AndroidManifest.xml -A "$OUT/assets" "$OUT/res.zip" \
  --min-sdk-version 29 --target-sdk-version 34 --version-code "$CODE" --version-name "$VERSION" \
  --no-compress-regex '\.wasm$' ${DEBUG:+--debug-mode}

echo "→ Code Java"
javac -nowarn --release 11 -classpath "$JAR" -d "$OUT/classes" $(find src -name '*.java') 2>&1 | grep -v -E '^(Note|warning):' || true
(cd "$OUT/classes" && "$BT/d8" --release --min-api 29 --lib "$JAR" --output "$OUT/dex" $(find . -name '*.class'))
cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT/dex" && zip -q "$OUT/unsigned.apk" classes.dex)
"$BT/zipalign" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

echo "→ Signature"
if [ ! -f "$KS" ]; then
  mkdir -p "$(dirname "$KS")"
  openssl rand -hex 24 > "$KS.pass" && chmod 600 "$KS.pass"
  keytool -genkeypair -keystore "$KS" -storepass:file "$KS.pass" -alias ledger -keyalg RSA -keysize 3072 -validity 20000 -dname "CN=Ledger" >/dev/null 2>&1
  chmod 600 "$KS"
  echo "  clé créée : $KS (garde-la, avec $KS.pass)"
fi
APK="$ROOT/dist/Ledger-$VERSION.apk"
"$BT/apksigner" sign --ks "$KS" --ks-pass "file:$KS.pass" --out "$APK" "$OUT/aligned.apk" 2>&1 | grep -v "^WARNING" || true
echo "APK : ${APK#$ROOT/} ($(du -h "$APK" | cut -f1 | tr -d ' '))"

if [ -n "${INSTALL:-}" ]; then
  ADB="$(command -v adb || echo "$SDK/platform-tools/adb")"
  "$ADB" install -r "$APK" && "$ADB" shell monkey -p app.ledger -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 && echo "Installée et lancée sur le téléphone."
fi
