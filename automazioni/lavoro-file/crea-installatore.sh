#!/bin/zsh
# T&C Factory — Crea l'installatore di TC Lavoro per una persona.
#
# Uso (dalla cartella creative-system, con la CLI di Supabase collegata):
#   automazioni/lavoro-file/crea-installatore.sh <nickname> "<nome del Mac>"
# Registra una chiave nuova in lavoro_dispositivi e crea sulla Scrivania
#   "TC Lavoro/Installa TC Lavoro - <nickname>.command"
# da mandare a quella persona (AirDrop): doppio clic (o tasto destro → Apri) e segue le istruzioni.
# La chiave sta solo nell'installatore e sul Mac: non va nel repository.
set -e
NICK="$1"; NOME="${2:-Mac di $1}"
[[ -z "$NICK" ]] && { echo "Uso: $0 <nickname> \"<nome del Mac>\""; exit 1; }
QUI="${0:A:h}"; CS="${QUI:h:h}"
CHIAVE=$(openssl rand -hex 24)
URL=$(sed -n "s/^const SUPABASE_URL = '\(.*\)';/\1/p" "$CS/js/supabase-config.js")
ANON=$(sed -n "s/^const SUPABASE_ANON_KEY = '\(.*\)';/\1/p" "$CS/js/supabase-config.js")

cd "$CS"
supabase db query --linked "insert into lavoro_dispositivi (chiave, utente, nome) values ('$CHIAVE', '$NICK', '${NOME//\'/\'\'}')" >/dev/null

OUT="$HOME/Desktop/TC Lavoro"; mkdir -p "$OUT"
F="$OUT/Installa TC Lavoro - $NICK.command"
{
  echo '#!/bin/zsh'
  echo "CHIAVE='$CHIAVE'; URL='$URL'; ANON='$ANON'"
  echo "cat > /tmp/tc-lavoro.js <<'FINE_JS'"
  cat "$QUI/TC Lavoro.js"
  echo 'FINE_JS'
  cat "$QUI/installa.zsh"
} > "$F"
chmod +x "$F"
echo "Creato: $F"
