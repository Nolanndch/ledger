#!/bin/bash
# Alternative à l'app Mac : installe Ledger comme service de fond (navigateur sur http://localhost:4747),
# lancé à l'ouverture de session et relancé s'il s'arrête. Ne pas l'utiliser en même temps que Ledger.app.
# Relance ce script après avoir modifié server.mjs ou public/ pour mettre à jour la version installée.
#   ./install.sh                 installe / met à jour
#   ./install.sh fichier.json    idem, et importe ce JSON si la base est encore vide
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DATA="$HOME/Library/Application Support/Ledger"
APP="$DATA/app"
PLIST="$HOME/Library/LaunchAgents/com.ledger.server.plist"
PORT=4747
NODE="$(command -v node || true)"

[ -n "$NODE" ] || { echo "Node.js introuvable (brew install node)"; exit 1; }
"$NODE" -e 'require("node:sqlite")' 2>/dev/null || { echo "Node 22.13+ requis pour node:sqlite ($("$NODE" -v))"; exit 1; }

# Copie hors de ~/Documents : macOS bloque l'accès de launchd à ce dossier.
mkdir -p "$APP" "$DATA/logs"
rsync -a --delete "$SRC/public/" "$APP/public/"
cp "$SRC/server.mjs" "$SRC/package.json" "$APP/"
rsync -a --delete "$SRC/server/" "$APP/server/"

if [ $# -ge 1 ] && [ ! -f "$DATA/ledger.db" ]; then
  "$NODE" "$APP/server.mjs" --import "$1"
fi

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.ledger.server</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$APP/server.mjs</string><string>--port</string><string>$PORT</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DATA/logs/server.log</string>
  <key>StandardErrorPath</key><string>$DATA/logs/server.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/com.ledger.server" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

for _ in $(seq 1 20); do curl -fs "http://localhost:$PORT/api/info" >/dev/null && break; sleep 0.25; done
if curl -fs "http://localhost:$PORT/api/info" >/dev/null; then
  echo "Ledger tourne sur http://localhost:$PORT"
  echo "Base : $DATA/ledger.db"
else
  echo "Le serveur n'a pas démarré, voir $DATA/logs/server.log"; exit 1
fi
