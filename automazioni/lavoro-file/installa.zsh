#!/bin/zsh
# T&C Factory — Installatore di TC Lavoro (tempo sui file dei clienti → task nel gestionale).
#
# Il comando lo dà il gestionale (Centro di controllo → Attivazioni), con la chiave del Mac:
#   curl -fsSL https://cs.pngs.it/mac/installa.zsh | zsh -s <chiave>
# Scarica tc-lavoro.js dal sito, lo compila in ~/Applications/TC Lavoro.app e lo fa partire
# a ogni accensione. Si può rilanciare: reinstalla e riparte.
set -e
CHIAVE="$1"
printf '%s' "$CHIAVE" | grep -Eq '^[0-9a-f]{32,}$' || { echo "Manca la chiave: copia il comando dal gestionale (Centro di controllo → Attivazioni)."; exit 1; }
SITO="https://cs.pngs.it"
CONFIG_JS=$(curl -fsSL "$SITO/js/supabase-config.js")
URL=$(print -r -- "$CONFIG_JS" | sed -n "s/^const SUPABASE_URL = '\(.*\)';/\1/p")
ANON=$(print -r -- "$CONFIG_JS" | sed -n "s/^const SUPABASE_ANON_KEY = '\(.*\)';/\1/p")
[[ -n "$URL" && -n "$ANON" ]] || { echo "Non riesco a leggere la configurazione dal sito."; exit 1; }
JS="${TMPDIR:-/tmp}/tc-lavoro-$$.js"
curl -fsSL "$SITO/mac/tc-lavoro.js" -o "$JS"
APP="$HOME/Applications/TC Lavoro.app"
CONF="$HOME/Library/Application Support/TC Lavoro"
AGENTE="$HOME/Library/LaunchAgents/it.tcfactory.lavoro.plist"

echo "Installo TC Lavoro…"
launchctl bootout "gui/$UID/it.tcfactory.lavoro" 2>/dev/null || true
pkill -f "TC Lavoro.app/Contents/MacOS" 2>/dev/null || true

mkdir -p "$CONF" "$HOME/Applications" "$HOME/Library/LaunchAgents"
printf '{"chiave":"%s","url":"%s","anon":"%s"}\n' "$CHIAVE" "$URL" "$ANON" > "$CONF/config.json"
chmod 600 "$CONF/config.json"

rm -rf "$APP"
osacompile -l JavaScript -s -o "$APP" "$JS"
rm -f "$JS"
P="$APP/Contents/Info.plist"
plutil -replace LSUIElement -bool true "$P"
plutil -replace CFBundleIdentifier -string it.tcfactory.lavoro "$P"
plutil -replace NSAppleEventsUsageDescription -string "TC Lavoro legge quale file è aperto in Illustrator, Photoshop e InDesign per contare il tempo di lavoro sui clienti." "$P"
codesign --force --deep -s - "$APP" 2>/dev/null

cat > "$AGENTE" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>it.tcfactory.lavoro</string>
  <key>ProgramArguments</key><array><string>$APP/Contents/MacOS/applet</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
</dict></plist>
PLIST
launchctl bootstrap "gui/$UID" "$AGENTE"

open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
osascript -e 'display dialog "TC Lavoro è installato e parte da solo a ogni accensione.

Ultimo passo: nella finestra Accessibilità che si è aperta, attiva \"TC Lavoro\" (se non c’è, premi + e scegli Applicazioni ▸ TC Lavoro nella tua cartella Inizio).

Quando Illustrator, Photoshop o InDesign chiedono se TC Lavoro può controllarli, rispondi Consenti." buttons {"OK"} default button 1 with title "TC Lavoro"' >/dev/null
echo "Fatto."
