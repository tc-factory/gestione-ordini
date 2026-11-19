#!/bin/zsh
# T&C Factory — installa sul Mac mini (utente csauto) il servizio della cartella DTF.
# Prima: condivisione DATI montata per csauto con l'utente NAS dedicato (vedi README)
# e ~/Library/Application Support/TC DTF/config.json con url, anon e chiave.
set -e
DIR="$HOME/Library/Application Support/TC DTF"
PLIST="$HOME/Library/LaunchAgents/it.tcfactory.dtf-cartella.plist"
mkdir -p "$DIR" "$HOME/Library/LaunchAgents"
cp "${0:A:h}/dtf_cartella.py" "$DIR/dtf_cartella.py"
[[ -f "$DIR/config.json" ]] || { echo "Manca $DIR/config.json"; exit 1; }
chmod 600 "$DIR/config.json"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>it.tcfactory.dtf-cartella</string>
  <key>ProgramArguments</key><array><string>/usr/bin/python3</string><string>$DIR/dtf_cartella.py</string></array>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$DIR/dtf-cartella.log</string>
  <key>StandardErrorPath</key><string>$DIR/dtf-cartella.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/it.tcfactory.dtf-cartella" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installato: ogni minuto. Registro: $DIR/dtf-cartella.log"
