#!/data/data/com.termux/files/usr/bin/bash
# Installe Ledger sur un téléphone Android, dans Termux (à installer depuis F-Droid, pas le Play Store).
#   curl -fsSL https://raw.githubusercontent.com/Nolanndch/ledger/main/termux/install.sh | bash
# Relancer la même commande met Ledger à jour.
set -euo pipefail

REPO="https://github.com/Nolanndch/ledger.git"
DIR="$HOME/ledger"

echo "→ Paquets (Node.js, git)…"
pkg update -y >/dev/null
pkg install -y nodejs git curl >/dev/null

node -e 'const { DatabaseSync } = require("node:sqlite"); if (!DatabaseSync.prototype.function) process.exit(1)' 2>/dev/null \
  || { echo "Node.js $(node -v) est trop ancien : il faut la version 22.13 ou plus récente."; exit 1; }

echo "→ Ledger…"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only --quiet; else git clone --depth 1 --quiet "$REPO" "$DIR"; fi

# Commande « ledger » : démarre le serveur s'il ne tourne pas, puis ouvre l'interface dans le navigateur.
cat > "$PREFIX/bin/ledger" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
DIR="$HOME/ledger"
LOG="$HOME/.local/share/ledger/server.log"
up() { curl -fs http://127.0.0.1:4747/api/ping >/dev/null 2>&1; }
case "${1:-}" in
  stop) pkill -f "node $DIR/server.mjs" && echo "Ledger arrêté." ; termux-wake-unlock; exit 0 ;;
  update) pkill -f "node $DIR/server.mjs" || true; git -C "$DIR" pull --ff-only && echo "Ledger mis à jour." ;;
  log) tail -n 50 "$LOG"; exit 0 ;;
esac
if ! up; then
  mkdir -p "$(dirname "$LOG")"
  termux-wake-lock   # empêche Android d'endormir le serveur
  nohup node "$DIR/server.mjs" >> "$LOG" 2>&1 &
  for _ in $(seq 1 40); do up && break; sleep 0.25; done
  up || { echo "Ledger n'a pas démarré : ledger log"; exit 1; }
fi
[ "${1:-}" = "--no-open" ] || termux-open-url http://localhost:4747
EOF
chmod +x "$PREFIX/bin/ledger"

# Démarrage automatique au démarrage du téléphone (si l'app Termux:Boot est installée et ouverte une fois).
mkdir -p "$HOME/.termux/boot"
printf '#!/data/data/com.termux/files/usr/bin/sh\nledger --no-open\n' > "$HOME/.termux/boot/ledger"
chmod +x "$HOME/.termux/boot/ledger"

ledger --no-open
echo
echo "Ledger tourne sur http://localhost:4747"
echo "Ouvre-le dans Chrome, puis menu ⋮ → Ajouter à l'écran d'accueil."
echo "Ensuite : Réglages → Synchronisation → Rejoindre un appareil, avec le code affiché sur le Mac."
echo "Commandes : ledger (démarrer + ouvrir), ledger stop, ledger update, ledger log"
