#!/bin/bash
# Arrête le service Ledger et retire le démarrage automatique. La base et les sauvegardes sont conservées.
launchctl bootout "gui/$(id -u)/com.ledger.server" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/com.ledger.server.plist"
echo "Service arrêté. Données conservées dans : $HOME/Library/Application Support/Ledger"
