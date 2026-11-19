#!/bin/zsh
# T&C Factory — installa sul Mac che vede il NAS il servizio che numera le cartelle DTF.
# Uso: zsh installa.zsh   (la config con la chiave va messa a parte, vedi dtf_cartelle.py)
set -e
DIR="$HOME/Library/Application Support/TC DTF"
PLIST="$HOME/Library/LaunchAgents/it.tcfactory.dtf-cartelle.plist"
mkdir -p "$DIR" "$HOME/Library/LaunchAgents"
cp "${0:A:h}/dtf_cartelle.py" "$DIR/dtf_cartelle.py"
[[ -f "$DIR/config.json" ]] || { echo "Manca $DIR/config.json"; exit 1; }
chmod 600 "$DIR/config.json"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>it.tcfactory.dtf-cartelle</string>
  <key>ProgramArguments</key><array><string>/usr/bin/python3</string><string>$DIR/dtf_cartelle.py</string></array>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$DIR/dtf-cartelle.log</string>
  <key>StandardErrorPath</key><string>$DIR/dtf-cartelle.log</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)/it.tcfactory.dtf-cartelle" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installato: controlla ogni minuto. Registro: $DIR/dtf-cartelle.log"
