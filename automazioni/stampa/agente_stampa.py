"""Agente di stampa: ponte tra il gestionale e le SC-F500 della sede.

Gira su un Mac in sede che vede le stampanti (oggi il Mac mini, servizio it.tcfactory.stampa).
Ogni 10 secondi chiede al gestionale il prossimo lavoro (tc_stampa_prossima, sql/stampa-coda.sql),
prende il PDF dalla cartella condivisa del mattino o, se non c'è, lo scarica dal gestionale
(funzione file-mattino), lo manda alla stampante col driver Epson (lp) con le impostazioni di
stampanti.json, aspetta che la stampante l'abbia ricevuto e scrive com'è andata (tc_stampa_esito).

Finché in stampanti.json la stampante non è "pronta" (preset e colori confermati con una stampa
di prova) non stampa nulla: il lavoro va in errore con il motivo, così non si spreca carta.

Chiave e indirizzi: lo stesso .env dello script del mattino (CS_SUPABASE_URL, CS_ANON_KEY, CS_AUTOMAZIONE_KEY).
"""

import argparse
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import traceback
from pathlib import Path

import requests

QUI = Path(__file__).resolve().parent
ATTESA = 10                 # secondi tra una domanda e l'altra
MAX_STAMPA = 3 * 3600       # oltre, il lavoro si considera bloccato


def log(testo):
    print(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {testo}", flush=True)


def carica_env(percorso):
    if percorso.exists():
        for riga in percorso.read_text().splitlines():
            if '=' in riga and not riga.lstrip().startswith('#'):
                k, v = riga.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip())
    mancanti = [k for k in ('CS_SUPABASE_URL', 'CS_ANON_KEY', 'CS_AUTOMAZIONE_KEY') if not os.environ.get(k)]
    if mancanti:
        sys.exit(f'Mancano le impostazioni: {", ".join(mancanti)}')


def rpc(funzione, **parametri):
    r = requests.post(f"{os.environ['CS_SUPABASE_URL']}/rest/v1/rpc/{funzione}",
                      headers={'apikey': os.environ['CS_ANON_KEY'], 'Content-Type': 'application/json'},
                      json={'p_chiave': os.environ['CS_AUTOMAZIONE_KEY'], **parametri}, timeout=60)
    r.raise_for_status()
    d = r.json()
    if not d.get('success'):
        raise RuntimeError(d.get('error') or 'Gestionale non raggiungibile')
    return d


def scarica(percorso, cartella_tmp):
    r = requests.post(f"{os.environ['CS_SUPABASE_URL']}/functions/v1/file-mattino",
                      headers={'apikey': os.environ['CS_ANON_KEY'], 'Content-Type': 'application/json'},
                      json={'chiave': os.environ['CS_AUTOMAZIONE_KEY'], 'azione': 'scarica', 'percorso': percorso}, timeout=60)
    d = r.json() if r.headers.get('content-type', '').startswith('application/json') else {}
    if not r.ok or not d.get('success'):
        raise RuntimeError(d.get('error') or f'HTTP {r.status_code}')
    f = Path(cartella_tmp) / Path(percorso).name
    with requests.get(d['link'], stream=True, timeout=(30, 1800)) as g:
        g.raise_for_status()
        with f.open('wb') as out:
            for pezzo in g.iter_content(1024 * 1024):
                out.write(pezzo)
    return f


def lpstat(*argomenti):
    return subprocess.run(['lpstat', *argomenti], capture_output=True, text=True, env={**os.environ, 'LANG': 'C'}).stdout


def stampa(file, cfg, titolo):
    """Manda il PDF alla coda CUPS e aspetta che la stampante l'abbia preso tutto."""
    comando = ['lp', '-d', cfg['coda'], '-t', titolo]
    for k, v in cfg.get('opzioni', {}).items():
        comando += ['-o', f'{k}={v}']
    comando.append(str(file))
    r = subprocess.run(comando, capture_output=True, text=True, env={**os.environ, 'LANG': 'C'})
    m = re.search(r'request id is (\S+)', r.stdout)
    if r.returncode or not m:
        raise RuntimeError(f"lp: {(r.stderr or r.stdout).strip()[:200]}")
    lavoro = m.group(1)
    log(f'inviato a {cfg["coda"]}: {lavoro}')
    inizio = time.time()
    while lavoro in lpstat('-W', 'not-completed', '-o', cfg['coda']):
        if 'disabled' in lpstat('-p', cfg['coda']):
            raise RuntimeError(f'la stampante {cfg["coda"]} si è fermata (controllare carta e inchiostri), lavoro {lavoro} in sospeso')
        if time.time() - inizio > MAX_STAMPA:
            raise RuntimeError(f'lavoro {lavoro} ancora in coda dopo {MAX_STAMPA // 3600} ore')
        time.sleep(5)
    if lavoro not in lpstat('-W', 'completed', '-o', cfg['coda']):
        raise RuntimeError(f'lavoro {lavoro} annullato')
    return lavoro


def esegui(lavoro, stampanti, base):
    cfg = stampanti.get(lavoro['stampante'])
    if not cfg:
        raise RuntimeError(f"stampante {lavoro['stampante']} non configurata su questo Mac")
    if not cfg.get('pronta'):
        raise RuntimeError('impostazioni di stampa da completare (preset e colori da confermare con una stampa di prova): nessun foglio stampato')
    locale = base / lavoro['percorso']
    with tempfile.TemporaryDirectory() as tmp:
        if locale.is_file():
            file = locale
        else:
            log(f"{lavoro['percorso']}: non è sul disco, lo scarico dal gestionale")
            file = scarica(lavoro['percorso'], tmp)
        return stampa(file, cfg, Path(lavoro['percorso']).stem)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cartella', required=True, type=Path, help='cartella del mattino (file già in sede)')
    ap.add_argument('--env', type=Path, default=QUI / '.env')
    ap.add_argument('--stampanti', type=Path, default=QUI / 'stampanti.json')
    args = ap.parse_args()
    carica_env(args.env)
    agente = socket.gethostname().split('.')[0]
    log(f'agente {agente} avviato')
    while True:
        try:
            stampanti = json.loads(args.stampanti.read_text()) if args.stampanti.exists() else {}
            lavoro = rpc('tc_stampa_prossima', p_agente=agente)['lavoro']
        except Exception as e:
            log(f'gestionale non raggiungibile: {e}')
            time.sleep(60)
            continue
        if not lavoro:
            time.sleep(ATTESA)
            continue
        log(f"lavoro {lavoro['id']}: {lavoro['percorso']} da {lavoro.get('richiesto_da')}")
        try:
            esegui(lavoro, stampanti, args.cartella)
            esito = dict(p_ok=True)
            log(f"lavoro {lavoro['id']}: stampato")
        except Exception as e:
            esito = dict(p_ok=False, p_errore=str(e))
            log(f"lavoro {lavoro['id']}: ERRORE {e}")
            if not isinstance(e, RuntimeError):
                log(traceback.format_exc())
        for _ in range(10):   # l'esito non si deve perdere: senza, il lavoro resterebbe "in stampa"
            try:
                rpc('tc_stampa_esito', p_id=lavoro['id'], **esito)
                break
            except Exception as e:
                log(f'esito non registrato, riprovo: {e}')
                time.sleep(30)


if __name__ == '__main__':
    main()
