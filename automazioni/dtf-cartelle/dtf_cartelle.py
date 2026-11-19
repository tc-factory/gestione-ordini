#!/usr/bin/python3
"""T&C Factory — numeri davanti alle cartelle di DTF/1. Stampa/1. Stampare.

Gira ogni minuto sul Mac che vede il NAS (launchd, vedi installa.zsh).
Il gestionale calcola i nomi nell'ordine della lista "DTF interno → Da stampare"
("01 - cf pavia", …) e li salva; qui si legge quel piano con tc_dtf_cartelle_piano
e si rinominano le cartelle che hanno un nome diverso. Le cartelle "Stampato"
e i file sciolti non si toccano. Solo libreria standard.

Config (fuori dal repository, il repo è pubblico):
  ~/Library/Application Support/TC DTF/config.json
  { "url": "...supabase.co", "anon": "...", "chiave": "..." }
"""
import json
import os
import re
import sys
import urllib.request
from datetime import datetime

CARTELLA = '/Volumes/DATI/DTF/1. Stampa/1. Stampare'
CONFIG = os.path.expanduser('~/Library/Application Support/TC DTF/config.json')
NUMERO = re.compile(r'^\d{1,3}\s*-\s*')
SALTA = re.compile(r'stampato', re.I)


def rpc(cfg, funzione, dati):
    req = urllib.request.Request(
        f"{cfg['url']}/rest/v1/rpc/{funzione}", data=json.dumps(dati).encode(),
        headers={'apikey': cfg['anon'], 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def main():
    if not os.path.isdir(CARTELLA):
        return 0   # NAS non montato: si riprova al prossimo giro
    with open(CONFIG) as f:
        cfg = json.load(f)
    r = rpc(cfg, 'tc_dtf_cartelle_piano', {'p_chiave': cfg['chiave']})
    if not r.get('success'):
        print('piano non letto:', r.get('error'), file=sys.stderr)
        return 1
    piano = (r.get('piano') or {}).get('cartelle') or {}
    if not piano:
        return 0

    fatte, errori = [], []
    for nome in sorted(os.listdir(CARTELLA)):
        percorso = os.path.join(CARTELLA, nome)
        if nome.startswith('.') or SALTA.search(nome) or not os.path.isdir(percorso):
            continue
        base = NUMERO.sub('', nome)
        nuovo = piano.get(base)
        if not nuovo or nuovo == nome or '/' in nuovo:
            continue
        dest = os.path.join(CARTELLA, nuovo)
        if os.path.exists(dest):
            errori.append(f'{nome} → {nuovo}: esiste già')
            continue
        try:
            os.rename(percorso, dest)
            fatte.append(f'{nome} → {nuovo}')
        except OSError as e:
            errori.append(f'{nome} → {nuovo}: {e.strerror}')

    if fatte or errori:
        ora = datetime.now().strftime('%Y-%m-%d %H:%M')
        print('\n'.join(f'{ora} {x}' for x in fatte + [f'ERRORE {e}' for e in errori]))
        try:   # nel registro del Centro di controllo, solo quando cambia qualcosa
            ini = rpc(cfg, 'tc_automazione_inizio', {'p_chiave': cfg['chiave'], 'p_nome': 'dtf-cartelle'})
            if ini.get('success'):
                rpc(cfg, 'tc_automazione_fine', {
                    'p_chiave': cfg['chiave'], 'p_id': ini['id'], 'p_stato': 'errore' if errori and not fatte else 'ok',
                    'p_riepilogo': {'rinominate': len(fatte), 'errori': len(errori)},
                    'p_output': '\n'.join(fatte + [f'ERRORE {e}' for e in errori])})
        except Exception as e:
            print('registro non scritto:', e, file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
