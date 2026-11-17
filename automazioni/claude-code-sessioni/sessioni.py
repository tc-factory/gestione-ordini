#!/usr/bin/env python3
"""T&C Factory — Sessioni di Claude Code → task completati nel gestionale.

Legge i registri delle sessioni di Claude Code di questo Mac (~/.claude/projects) per le cartelle
senza GitHub (Aggeggio, app di Box Factory Lab, Lavorazione, 00-Prodotti) e registra una riga per
sessione e giorno con tc_registra_sessione (sql/task-sessioni-claude-code.sql):
titolo della sessione, minuti di lavoro attivo (pause oltre 10 minuti escluse).

Scrive gli SQL in un file temporaneo e li esegue con la CLI di Supabase già collegata al progetto
(cartella creative-system). Uso: sessioni.py [giorni]  (default 3; 0 = tutto lo storico).
Lo lancia ogni 15 minuti l'agente launchd it.tcfactory.sessioni-claude-code.
"""
import json, os, re, subprocess, sys, tempfile
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

PROGETTI = {   # prefisso della cartella dei registri → nome del progetto
    '-Users-rp-Documents-aggeggio': 'Aggeggio',
    '-Users-rp-Documents-box-factory-lab': 'Box Factory Lab (app clienti)',
    '-Users-rp-Documents-lavorazione': 'Lavorazione',
    '-Users-rp-Documents-00-Prodotti': '00-Prodotti',
}
PAUSA_MAX = timedelta(minutes=10)
ROMA = ZoneInfo('Europe/Rome')
REGISTRI = Path.home() / '.claude' / 'projects'
CS = Path(__file__).resolve().parents[2]


def testo_utente(msg):
    c = msg.get('content')
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return ' '.join(p.get('text', '') for p in c if isinstance(p, dict) and p.get('type') == 'text')
    return ''


# Blocchi aggiunti da Claude Code (istruzioni del browser, promemoria di sistema, comandi): non sono la richiesta
BLOCCHI = re.compile(r'<([a-zA-Z][\w-]*)[^>]*>.*?</\1>', re.S)
TITOLI_GENERICI = ('Claude in Chrome', 'Browser automation')


def pulisci(t):
    # Via anche le menzioni iniziali (@browser:new_tab, @file…)
    return re.sub(r'^(@\S+\s*)+', '', BLOCCHI.sub('', t).strip()).strip()


def richiesta_vera(t):
    return bool(t) and not t.startswith('<') and not t.startswith('[Request interrupted')


def leggi(file, progetto, cartella):
    titolo, giorni = None, defaultdict(lambda: {'orari': [], 'richieste': []})
    for riga in file.open(encoding='utf-8', errors='ignore'):
        try:
            o = json.loads(riga)
        except ValueError:
            continue
        if o.get('type') == 'ai-title' and o.get('aiTitle') and not o['aiTitle'].startswith(TITOLI_GENERICI):
            titolo = o['aiTitle']
        if o.get('type') not in ('user', 'assistant') or o.get('isSidechain') or not o.get('timestamp'):
            continue
        at = datetime.fromisoformat(o['timestamp'].replace('Z', '+00:00'))
        g = giorni[at.astimezone(ROMA).date().isoformat()]
        g['orari'].append(at)
        if o['type'] == 'user' and not o.get('isMeta'):
            t = pulisci(testo_utente(o.get('message') or {}))
            if richiesta_vera(t):
                g['richieste'].append(t)
    righe = []
    for giorno, g in giorni.items():
        if not g['richieste']:
            continue   # nessuna richiesta di una persona quel giorno (solo riprese automatiche)
        orari = sorted(g['orari'])
        attivo = sum(((b - a) for a, b in zip(orari, orari[1:]) if b - a <= PAUSA_MAX), timedelta())
        richieste = g['richieste']
        righe.append({
            'sessione': f'{file.stem}:{giorno}', 'cartella': cartella, 'progetto': progetto, 'giorno': giorno,
            'fine': orari[-1].isoformat(), 'minuti': max(1, round(attivo.total_seconds() / 60)),
            'titolo': titolo or ' '.join(richieste[0].split())[:120],
            'descrizione': '\n\n'.join(f'• {r[:400]}' for r in richieste[:8]),
        })
    return righe


def main():
    giorni = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    dal = datetime.now(timezone.utc) - timedelta(days=giorni) if giorni else None
    righe = []
    for cartella in sorted(REGISTRI.iterdir()):
        progetto = next((p for pref, p in PROGETTI.items() if cartella.name == pref or cartella.name.startswith(pref + '-')), None)
        if not progetto:
            continue
        for f in cartella.glob('*.jsonl'):
            if dal and datetime.fromtimestamp(f.stat().st_mtime, timezone.utc) < dal:
                continue
            righe += [r for r in leggi(f, progetto, cartella.name) if not dal or r['fine'] >= dal.isoformat()]
    if not righe:
        print('Nessuna sessione da registrare')
        return
    sql = '\n'.join("select tc_registra_sessione('%s'::jsonb);" % json.dumps(r, ensure_ascii=False).replace("'", "''") for r in righe)
    with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False, encoding='utf-8') as t:
        t.write(sql + '\n')
    try:
        r = subprocess.run(['supabase', 'db', 'query', '--linked', '-f', t.name], cwd=CS, capture_output=True, text=True)
        if r.returncode != 0:
            sys.exit(f'Errore Supabase: {r.stderr[-500:]}')
        print(f'{len(righe)} sessioni registrate')
    finally:
        os.unlink(t.name)


if __name__ == '__main__':
    main()
