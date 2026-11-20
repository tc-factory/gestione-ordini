#!/usr/bin/python3
"""T&C Factory — cartella DTF "1. Stampare" sul NAS → gestionale.

Gira ogni minuto sul Mac mini (launchd, vedi installa.zsh), così funziona per tutti i PC,
anche Windows, senza collegare niente nel browser:
  • abbina ogni sottocartella a un ordine della lista DTF interno → Da stampare
    (la lista la pubblica il gestionale in app_settings 'dtf_lista', già in ordine);
  • legge misura e pezzi dei file nuovi e scrive file e metri sull'ordine;
  • quando arriva un DTF nuovo, o col bottone "Numera ora", mette davanti alle cartelle
    il numero dell'ordine nella lista ("01 - cf pavia").
Le cartelle "Stampato" e "PDF originali" sono escluse; i file sciolti si abbinano col loro nome e non si rinominano.
File sciolti palesemente dello stesso ordine (stesse prime parole) → in una cartella col nome comune.
PDF senza TIF accanto → task "Creare il file TIF"; dal task "Genera TIFF automatico" (riduzione 0-3 px)
li converte dtf_tiff.py (venv a parte) e i PDF vanno nella sottocartella "PDF originali".
Non toglie mai file dagli ordini (quelli spostati in Stampato restano nei metri).
Stesse regole di js/dtf-misure.js e js/dtf-cartella.js. Solo libreria standard.

Uso:  dtf_cartella.py [--prova] [--cartella PERCORSO]
  --prova  legge e stampa cosa farebbe, senza scrivere né rinominare

Config (fuori dal repository, il repo è pubblico):
  ~/Library/Application Support/TC DTF/config.json  { "url", "anon", "chiave" }
"""
import argparse
import base64
import fcntl
import filecmp
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

CARTELLA = '/Volumes/DATI/DTF/1. Stampa/1. Stampare'
DIR_DATI = os.path.expanduser('~/Library/Application Support/TC DTF')
CONFIG = os.path.join(DIR_DATI, 'config.json')
STATO = os.path.join(DIR_DATI, 'stato.json')

EXT = re.compile(r'\.(tiff?|pdf|png|jpe?g)$', re.I)
SALTA_DIR = re.compile(r'stampato|^\s*pdf originali\s*$', re.I)
# PDF convertiti in TIF: messi da parte qui (esclusa dalla lettura, così i metri non contano due volte)
PDF_DIR = 'PDF originali'
TIFF_PY = os.path.join(DIR_DATI, 'venv', 'bin', 'python')
TIFF_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dtf_tiff.py')
TIFF_ICC = os.path.join(DIR_DATI, 'fogra39.icc')
# File sciolti raggruppati: parole che non dicono di chi è il file (non bastano per fare una cartella)
GENERICHE = {'fronte', 'retro', 'dietro', 'davanti', 'lato', 'cuore', 'manica', 'maniche', 'petto', 'spalla', 'logo',
             'dtf', 'stampa', 'stampare', 'file', 'copia', 'nuovo', 'nuova', 'front', 'back', 'left', 'right', 'sx', 'dx',
             'bianco', 'nero', 'colore', 'pz', 'pezzi', 'pezzo', 'tif', 'tiff', 'pdf', 'png', 'jpg', 'def', 'definitivo', 'ok'}
SCIOLTI_ATTESA = 120   # secondi senza modifiche prima di spostare un file sciolto
URGENZE = re.compile(r'urgenz[ae]', re.I)   # conto terzi: cartelle copiate tutti i giorni lavorativi
NUMERO = re.compile(r'^\d{1,3}\s*-\s*')
# File da stampare con la colla nera: dalle cartelle degli ordini, sciolti, nella cartella "COLLA NERA"
COLLA_NERA = 'COLLA NERA'
COLLA_DIR = re.compile(r'colla\s*nera', re.I)
COLLA_FILE = re.compile(r'(?<![a-z])(colla\s*nera|leggings?|shorts?|soft\s*shell|k\s*way|wind\s*stopper|nylon)', re.I)
COLLA_ATTESA = 120   # secondi senza modifiche prima di spostare (file ancora in caricamento)
DPI_DEFAULT = 300
CM_INCH = 2.54


# ── Database ──

def rpc(cfg, funzione, dati):
    req = urllib.request.Request(
        f"{cfg['url']}/rest/v1/rpc/{funzione}", data=json.dumps(dati).encode(),
        headers={'apikey': cfg['anon'], 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


# ── Pezzi e metri (come DtfMisure) ──

def parse_pz(name):
    base = re.sub(r'\.[a-z0-9]{2,5}$', '', name, flags=re.I)
    m = (re.search(r'(\d+)\s*pz\b', base, re.I) or re.search(r'\bpz\s*(\d+)', base, re.I)
         or re.search(r'(\d+)\s*pz', base, re.I))
    n = int(m.group(1)) if m else 0
    return (n, True) if n > 0 else (1, False)


def layout(w, h, pz, roll, gap):
    if not (w and w > 0 and h and h > 0):
        return {'error': 'misura mancante'}
    pz = max(1, int(pz or 1))

    def prova(across, along, rotated):
        per_row = math.floor((roll + gap) / (across + gap))
        if per_row < 1:
            return None
        rows = math.ceil(pz / per_row)
        return {'cm': rows * along + (rows - 1) * gap, 'perRow': per_row, 'rows': rows, 'rotated': rotated}

    opts = [o for o in (prova(w, h, False), prova(h, w, True)) if o]
    if not opts:
        return {'error': f'più largo del rotolo ({roll:g} cm)'}
    best = min(opts, key=lambda o: o['cm'])
    # math.floor(+0.5) come Math.round del gestionale (round di Python arrotonda lo 0,5 al pari)
    return {'metri': math.floor(best['cm'] + 0.5) / 100, 'perRow': best['perRow'], 'rotated': best['rotated']}


def js_round1(x):
    return math.floor(x * 10 + 0.5) / 10


def da_pixel(w, h, dpi, fonte):
    ipot = not (dpi and dpi > 0)
    d = DPI_DEFAULT if ipot else dpi
    cm = lambda px: js_round1(px / d * CM_INCH)
    return {'w_cm': cm(w), 'h_cm': cm(h), 'fonte': fonte, 'dpi': round(d), 'dpi_ipotizzato': ipot}


# ── Misura di stampa dal file (solo intestazioni) ──

def leggi_tif(f):
    head = f.read(16)
    bo = {b'II': '<', b'MM': '>'}.get(head[:2])
    if not bo:
        raise ValueError('TIFF non valido')
    ver = struct.unpack(bo + 'H', head[2:4])[0]
    big = ver == 43
    if not big and ver != 42:
        raise ValueError('TIFF non valido')
    ifd = struct.unpack(bo + ('Q' if big else 'I'), head[8:16] if big else head[4:8])[0]
    f.seek(ifd)
    n = struct.unpack(bo + ('Q' if big else 'H'), f.read(8 if big else 2))[0]
    size = 20 if big else 12
    d = f.read(n * size)
    tags = {}
    for i in range(n):
        o = i * size
        tag, typ = struct.unpack(bo + 'HH', d[o:o + 4])
        val = o + (12 if big else 8)
        if tag not in (256, 257, 282, 283, 296):
            continue
        if typ == 3:
            tags[tag] = struct.unpack(bo + 'H', d[val:val + 2])[0]
        elif typ == 4:
            tags[tag] = struct.unpack(bo + 'I', d[val:val + 4])[0]
        elif typ == 16:
            tags[tag] = struct.unpack(bo + 'Q', d[val:val + 8])[0]
        elif typ == 5:
            off = struct.unpack(bo + ('Q' if big else 'I'), d[val:val + (8 if big else 4)])[0]
            pos = f.tell()
            f.seek(off)
            num, den = struct.unpack(bo + 'II', f.read(8))
            f.seek(pos)
            tags[tag] = num / den if den else 0
    w, h = tags.get(256), tags.get(257)
    if not w or not h:
        raise ValueError('dimensioni TIFF non trovate')
    unit = tags.get(296, 2)
    dpi = tags.get(282) or 0
    if unit == 3:
        dpi *= CM_INCH
    elif unit == 1:
        dpi = 0
    return da_pixel(w, h, dpi, 'tif')


def leggi_png(f):
    buf = f.read(4 * 1024 * 1024)
    if buf[:4] != b'\x89PNG':
        raise ValueError('PNG non valido')
    off, w, h, dpi = 8, 0, 0, 0
    while off + 8 <= len(buf):
        ln = struct.unpack('>I', buf[off:off + 4])[0]
        typ = buf[off + 4:off + 8]
        if typ == b'IHDR':
            w, h = struct.unpack('>II', buf[off + 8:off + 16])
        if typ == b'pHYs' and buf[off + 16] == 1:
            dpi = struct.unpack('>I', buf[off + 8:off + 12])[0] * 0.0254
        if typ in (b'IDAT', b'IEND'):
            break
        off += 12 + ln
    if not w or not h:
        raise ValueError('dimensioni PNG non trovate')
    return da_pixel(w, h, dpi, 'png')


def leggi_jpg(f):
    buf = f.read(1024 * 1024)
    if buf[:2] != b'\xff\xd8':
        raise ValueError('JPG non valido')
    off, w, h, dpi = 2, 0, 0, 0
    while off + 4 <= len(buf):
        if buf[off] != 0xFF:
            off += 1
            continue
        marker = buf[off + 1]
        ln = struct.unpack('>H', buf[off + 2:off + 4])[0]
        if marker == 0xE0 and buf[off + 4:off + 8] == b'JFIF':
            unit, dens = buf[off + 11], struct.unpack('>H', buf[off + 12:off + 14])[0]
            dpi = dens if unit == 1 else dens * CM_INCH if unit == 2 else 0
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            h, w = struct.unpack('>HH', buf[off + 5:off + 9])
            break
        off += 2 + ln
    if not w or not h:
        raise ValueError('dimensioni JPG non trovate')
    return da_pixel(w, h, dpi, 'jpg')


def leggi_pdf(f):
    # Prima pagina: /MediaBox (o /CropBox) in chiaro; se è compressa la misura va messa a mano
    buf = f.read(2 * 1024 * 1024).decode('latin-1')
    num = r'(-?[\d.]+)'
    m = re.search(r'/(?:CropBox|MediaBox)\s*\[\s*' + r'\s+'.join([num] * 4) + r'\s*\]', buf)
    if not m:
        raise ValueError('misura PDF non trovata')
    x0, y0, x1, y1 = map(float, m.groups())
    cm = lambda pt: js_round1(abs(pt) / 72 * CM_INCH)
    return {'w_cm': cm(x1 - x0), 'h_cm': cm(y1 - y0), 'fonte': 'pdf'}


def misura_da(f, name):
    name = name.lower()
    try:
        if name.endswith('.pdf'):
            return leggi_pdf(f)
        if re.search(r'\.tiff?$', name):
            return leggi_tif(f)
        if name.endswith('.png'):
            return leggi_png(f)
        if re.search(r'\.jpe?g$', name):
            return leggi_jpg(f)
    except Exception as e:
        print(f'  illeggibile {name}: {e}', file=sys.stderr)
        return {'fonte': 'illeggibile'}
    return {'fonte': 'formato'}


def leggi_misura(path):
    try:
        with open(path, 'rb') as f:
            return misura_da(f, path)
    except OSError as e:
        print(f'  illeggibile {path}: {e}', file=sys.stderr)
        return {'fonte': 'illeggibile'}


def descrivi(path, name, roll, gap, misura=None):
    pz, trovati = parse_pz(name)
    f = {'name': name, 'pz': pz, 'pz_trovati': trovati, **(misura if misura is not None else leggi_misura(path))}
    r = layout(f.get('w_cm'), f.get('h_cm'), pz, roll, gap)
    f.update({'metri': None if 'error' in r else r['metri'], 'errore': r.get('error'),
              'per_riga': r.get('perRow'), 'ruotato': bool(r.get('rotated'))})
    return f


# ── Abbinamento cartella → ordine (come DtfCartella.abbina) ──

def tokens(s):
    s = unicodedata.normalize('NFD', str(s or ''))
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower()
    return ['crossfit' if t == 'cf' else t for t in re.sub(r'[^a-z0-9]+', ' ', s).split()]


def core(s):
    return ''.join(t for t in tokens(s) if t != 'crossfit')


def abbina(nome, ordini):
    fc, ft = core(nome), set(tokens(nome))
    if len(fc) < 4:
        return None
    best, best_score, pari = None, 0, False
    for o in ordini:
        n = core(o.get('nome'))
        if len(n) < 4 or not (n in fc or fc in n):
            continue
        bonus = sum(1 for t in tokens(o.get('descr')) if len(t) >= 4 and t in ft)
        score = (20 if fc == n else 10) + bonus
        if score > best_score:
            best, best_score, pari = o, score, False
        elif score == best_score:
            pari = True
    return 'ambiguo' if pari else best


def proprietario(nome_cartella, ordini, items_db, preparati):
    """Più ordini con lo stesso nome (es. due CROSSFIT MONZA): la cartella è dell'ordine per cui
    l'ha creata l'automazione, oppure di quello che ha già i suoi file. None se non si capisce."""
    ids = {o['id'] for o in ordini}
    oid = (preparati or {}).get(nome_cartella)
    if oid in ids:
        return oid
    k = base(nome_cartella).strip().lower()
    con_file = [o['id'] for o in ordini if any(x.get('cartella') and base(x['cartella'].split('/')[0]).strip().lower() == k
                                                for x in (items_db.get(o['id']) or []))]
    return con_file[0] if len(con_file) == 1 else None


def base(nome):
    return NUMERO.sub('', nome)


def chiave(path):
    a, _, r = path.partition('/')
    return base(a) + ('/' + r if r else '')


# ── Cartella ──

def salta(name):
    return name.startswith('.') or name.lower() in ('thumbs.db', 'desktop.ini')


def files_di(dir_path, rel):
    out = []
    for name in sorted(os.listdir(dir_path)):
        if salta(name):
            continue
        p = os.path.join(dir_path, name)
        if os.path.isdir(p):
            if not SALTA_DIR.search(name):
                out += files_di(p, f'{rel}/{name}')
        elif EXT.search(name):
            out.append({'abs': p, 'path': f'{rel}/{name}', 'name': name})
    return out


def gruppi_di(cartella):
    gruppi = []
    for name in sorted(os.listdir(cartella)):
        if salta(name):
            continue
        p = os.path.join(cartella, name)
        if os.path.isdir(p):
            if not SALTA_DIR.search(name):
                gruppi.append({'nome': base(name), 'dir': name, 'files': files_di(p, name)})
        elif EXT.search(name):
            gruppi.append({'nome': re.sub(r'\.[a-z0-9]{2,5}$', '', name, flags=re.I),
                           'files': [{'abs': p, 'path': name, 'name': name}], 'sciolto': True})
    return gruppi


def cartella_colla(cartella):
    return next((n for n in sorted(os.listdir(cartella)) if os.path.isdir(os.path.join(cartella, n))
                 and COLLA_DIR.fullmatch(base(n).strip())), None)


def sposta_colla_nera(cartella, prova, escluse=()):
    """File con "colla nera", "leggings", "short", "soft shell", "kway", "windstopper" o "nylon" nel nome (o in una sottocartella) dentro le
    cartelle degli ordini → sciolti in COLLA NERA, col nome dell'ordine davanti se non c'è già
    ("cf pavia/Leggings_5pz.tif" → "COLLA NERA/cf pavia - Leggings_5pz.tif"). Solo file fermi da 2 minuti;
    le cartelle dei clienti conto terzi (K1) restano come sono."""
    colla = cartella_colla(cartella) or COLLA_NERA
    spostati, errori, ora = [], [], time.time()
    for name in sorted(os.listdir(cartella)):
        p = os.path.join(cartella, name)
        if (salta(name) or not os.path.isdir(p) or SALTA_DIR.search(name) or COLLA_DIR.fullmatch(base(name).strip())
                or base(name).strip().lower() in escluse):
            continue
        ordine = base(name).strip()
        for fl in files_di(p, name):
            if not COLLA_FILE.search(re.sub(r'[_.\-]+', ' ', fl['path'].split('/', 1)[1])):
                continue
            st = os.stat(fl['abs'])
            if ora - st.st_mtime < COLLA_ATTESA:
                continue
            nome = fl['name'] if core(ordine) in core(fl['name']) else f"{ordine} - {fl['name']}"
            gia = os.path.join(cartella, colla, nome)
            if os.path.exists(gia) and filecmp.cmp(gia, fl['abs'], shallow=False):
                continue   # già messo a mano in COLLA NERA: non si fa un doppione
            dest = nome_libero(os.path.join(cartella, colla), nome, -1)
            if prova:
                spostati.append(f"{fl['path']} → {colla}/{os.path.basename(dest)}")
                continue
            try:
                os.makedirs(os.path.join(cartella, colla), exist_ok=True)
                os.rename(fl['abs'], dest)
                spostati.append(f"{fl['path']} → {colla}/{os.path.basename(dest)}")
            except OSError as e:
                errori.append(f"{fl['path']} → {colla}: {e.strerror}")
    return spostati, errori


def _parole(stem):
    """Parole del nome del file, con la loro forma per il confronto (come tokens: cf = crossfit)."""
    out = []
    for p in re.split(r'[^0-9A-Za-zÀ-ÿ]+', stem):
        t = tokens(p)
        if t:
            out.append((p, t[0]))
    return out


def _prefisso(parole, k):
    """Prime k parole senza quelle in coda che non dicono di chi è il file (fronte, retro, numeri…)."""
    p = parole[:k]
    while p and (p[-1][1] in GENERICHE or p[-1][1].isdigit() or re.fullmatch(r'\d+pz', p[-1][1])):
        p = p[:-1]
    return p


def raggruppa_sciolti(cartella, prova, escluse=()):
    """File sciolti in 1. Stampare palesemente dello stesso ordine: le prime parole del nome uguali
    ("House dietro 100 pezzi.pdf" e "House lato cuore 100 pezzi.pdf") → cartella "House".
    Ogni file va col gruppo più lungo che ha in comune con almeno un altro file; se c'è già una cartella
    con quel nome (anche numerata, "05 - House") vanno lì, e lì va anche un file da solo che inizia col
    suo nome. Il nome comune deve avere almeno 3 lettere che non siano parole generiche. Solo file fermi
    da 2 minuti. Ritorna (spostati, errori)."""
    ora, sciolti = time.time(), []
    for name in sorted(os.listdir(cartella)):
        p = os.path.join(cartella, name)
        if salta(name) or not EXT.search(name) or not os.path.isfile(p):
            continue
        if ora - os.stat(p).st_mtime < SCIOLTI_ATTESA:
            continue
        parole = _parole(re.sub(r'\.[a-z0-9]{2,5}$', '', name, flags=re.I))
        if parole and not parole[0][1].isdigit():
            sciolti.append({'name': name, 'abs': p, 'parole': parole})
    if not sciolti:
        return [], []
    cartelle = {}
    for n in os.listdir(cartella):
        if os.path.isdir(os.path.join(cartella, n)) and not salta(n) and not SALTA_DIR.search(n) \
                and base(n).strip().lower() not in escluse:
            cartelle.setdefault(core(base(n)), n)

    def chiave_di(parole):
        return core(' '.join(t for _, t in parole))

    gruppi = {}
    for f in sciolti:
        scelta = None
        # cartella che c'è già col nome delle prime parole (la più lunga)
        for k in range(len(f['parole']), 0, -1):
            pr = _prefisso(f['parole'], k)
            if pr and len(chiave_di(pr)) >= 3 and chiave_di(pr) in cartelle:
                scelta = (chiave_di(pr), cartelle[chiave_di(pr)])
                break
        if not scelta:
            # le prime parole più lunghe in comune con un altro file sciolto
            for k in range(len(f['parole']) - 1, 0, -1):
                pr = _prefisso(f['parole'], k)
                if not pr or len(chiave_di(pr)) < 3:
                    continue
                toks = [t for _, t in f['parole'][:k]]
                if any(g is not f and [t for _, t in g['parole'][:k]] == toks for g in sciolti):
                    scelta = (chiave_di(pr), ' '.join(w for w, _ in pr).strip())
                    break
        if scelta:
            gruppi.setdefault(scelta[0], {'dir': scelta[1], 'files': []})['files'].append(f)

    spostati, errori = [], []
    for k, g in gruppi.items():
        esiste = k in cartelle
        if not esiste and len(g['files']) < 2:
            continue
        dest_dir = os.path.join(cartella, g['dir'])
        for f in g['files']:
            dest = os.path.join(dest_dir, f['name'])
            if os.path.exists(dest):
                errori.append(f"{f['name']} → {g['dir']}: c'è già un file con questo nome")
                continue
            if prova:
                spostati.append(f"{f['name']} → {g['dir']}/")
                continue
            try:
                os.makedirs(dest_dir, exist_ok=True)
                os.rename(f['abs'], dest)
                spostati.append(f"{f['name']} → {g['dir']}/")
            except OSError as e:
                errori.append(f"{f['name']} → {g['dir']}: {e.strerror}")
    return spostati, errori


# ── PDF da trasformare in TIF ──

def _radice(nome):
    return os.path.splitext(nome)[0].strip().lower()


def pdf_senza_tif(files):
    """PDF di un gruppo che non hanno accanto il loro TIF (<nome>.tif o <nome> - pag N.tif)."""
    tif = {}
    for f in files:
        if re.search(r'\.tiff?$', f['name'], re.I):
            tif.setdefault(os.path.dirname(f['abs']), set()).add(re.sub(r'\s*-\s*pag\s*\d+$', '', _radice(f['name'])))
    return [f for f in files if f['name'].lower().endswith('.pdf')
            and _radice(f['name']) not in tif.get(os.path.dirname(f['abs']), set())]


def genera_tiff(richieste, gruppi, stato, prova):
    """Richieste dal task "Genera TIFF automatico" (app_settings dtf_tiff_richieste: {cartella: {riduzione, at}}):
    per ogni PDF senza TIF della cartella crea i TIF accanto (dtf_tiff.py) e mette il PDF in "PDF originali".
    Ogni richiesta si fa una volta sola; gli errori restano nell'esito finché non si riprova.
    Ritorna (righe per il registro, True se ha cambiato file)."""
    fatte = stato.setdefault('tiff_fatte', {})
    errori = stato.setdefault('tiff_errori', {})
    righe, cambiato = [], False
    for nome, r in (richieste or {}).items():
        if not isinstance(r, dict) or not r.get('at') or fatte.get(nome) == r['at']:
            continue
        g = next((x for x in gruppi if x['nome'].strip().lower() == nome.strip().lower()), None)
        pdf = pdf_senza_tif(g['files']) if g else []
        try:
            rid = max(0, min(3, int(r.get('riduzione') or 0)))
        except (TypeError, ValueError):
            rid = 0
        if prova:
            print(f"  tiff {nome}: convertirei {len(pdf)} PDF con riduzione {rid} px")
            continue
        errori.pop(nome, None)
        msg = []
        for f in pdf:
            try:
                if not os.path.exists(TIFF_PY) or not os.path.exists(TIFF_ICC):
                    raise RuntimeError('convertitore non installato sul Mac mini')
                out = subprocess.run([TIFF_PY, '-I', TIFF_SCRIPT, f['abs'], str(rid), '--icc', TIFF_ICC],
                                     capture_output=True, text=True, timeout=1200)
                if out.returncode != 0:
                    righe_err = (out.stderr or out.stdout or '').strip().splitlines()
                    raise RuntimeError(righe_err[-1] if righe_err else 'errore sconosciuto')
                scritti = json.loads(out.stdout.strip().splitlines()[-1])
                cartella_pdf = os.path.join(os.path.dirname(f['abs']), PDF_DIR)
                os.makedirs(cartella_pdf, exist_ok=True)
                os.rename(f['abs'], nome_libero(cartella_pdf, f['name'], os.path.getsize(f['abs'])))
                cambiato = True
                righe.append(f"tiff {nome}: {f['name']} → {', '.join(scritti)} (riduzione {rid} px)")
            except Exception as e:
                testo = 'tempo scaduto' if isinstance(e, subprocess.TimeoutExpired) else str(e)
                msg.append(f"{f['name']}: {testo}")
                righe.append(f"ERRORE tiff {nome}: {f['name']}: {testo}")
        if msg:
            errori[nome] = '; '.join(msg)[:500]
        fatte[nome] = r['at']
    # le cartelle che non ci sono più non tengono errori né richieste vecchie
    nomi = {x['nome'].strip().lower() for x in gruppi}
    for d in (fatte, errori):
        for k in [k for k in d if k.strip().lower() not in nomi]:
            d.pop(k)
    return righe, cambiato


def stesso_file(fl, x, st):
    """Il file è quello già sull'ordine, spostato (anche col nome dell'ordine davanti): stessa misura e data."""
    return (x.get('name') and x.get('size') == st.st_size and x.get('mtime') == int(st.st_mtime * 1000)
            and (fl['name'] == x['name'] or fl['name'].endswith(' - ' + x['name'])))


# File dell'ordine: aggiunge i nuovi, rilegge i cambiati, non toglie niente (come DtfCartella._aggiorna)
def aggiorna_items(items, files, roll, gap):
    items = [dict(x) for x in (items or []) if x and x.get('name')]
    aggiunti, cambiati = 0, False
    for fl in files:
        st = os.stat(fl['abs'])
        size, mtime = st.st_size, int(st.st_mtime * 1000)
        k = chiave(fl['path'])
        i = next((j for j, x in enumerate(items) if x.get('cartella') and chiave(x['cartella']) == k), -1)
        if i < 0:
            i = next((j for j, x in enumerate(items) if not x.get('cartella') and x['name'] == fl['name']), -1)
        if i < 0:   # spostato (es. in COLLA NERA)
            i = next((j for j, x in enumerate(items) if stesso_file(fl, x, st)), -1)
        it = items[i] if i >= 0 else None
        if it and (not it.get('cartella') or (it.get('size') == size and it.get('mtime') == mtime)):
            if it.get('cartella') != fl['path']:
                it.update({'cartella': fl['path'], 'size': size, 'mtime': mtime})
                cambiati = True
            continue
        d = {**descrivi(fl['abs'], fl['name'], roll, gap), 'cartella': fl['path'], 'size': size, 'mtime': mtime}
        if it:
            items[i] = d
        else:
            items.append(d)
            aggiunti += 1
        cambiati = True
    # Lo stesso file due volte (spostato, es. in COLLA NERA: stesso nome, misura e data) conta una volta sola:
    # resta la voce col percorso che c'è adesso
    presenti = {chiave(fl['path']) for fl in files}
    gruppi = {}
    for j, x in enumerate(items):
        if x.get('size') is not None and x.get('mtime') is not None:
            gruppi.setdefault((x['name'].rsplit('/', 1)[-1], x['size'], x['mtime']), []).append(j)
    via = set()
    for js in gruppi.values():
        if len(js) > 1:
            tieni = next((j for j in js if items[j].get('cartella') and chiave(items[j]['cartella']) in presenti), js[0])
            via |= {j for j in js if j != tieni}
    # Voce trascinata a mano (senza misura del file) doppia di un file letto dalla cartella: stesso nome e metri
    letti = {(k[0], items[js[0]].get('metri')) for k, js in gruppi.items()}
    via |= {j for j, x in enumerate(items) if x.get('size') is None and x.get('metri')
            and (x['name'].rsplit('/', 1)[-1], x.get('metri')) in letti}
    # PDF trasformato in TIF (il PDF è andato in "PDF originali"): conta solo il TIF
    tif = {re.sub(r'\s*-\s*pag\s*\d+$', '', _radice(chiave(fl['path']))) for fl in files if re.search(r'\.tiff?$', fl['name'], re.I)}
    via |= {j for j, x in enumerate(items) if x.get('cartella') and x['cartella'].lower().endswith('.pdf')
            and chiave(x['cartella']) not in presenti and _radice(chiave(x['cartella'])) in tif}
    if via:
        items = [x for j, x in enumerate(items) if j not in via]
        cambiati = True
    return items, aggiunti, cambiati


# Nome giusto di ogni cartella in d['target']; quelle senza ordine perdono il numero
def numera(dirs):
    numerate = sorted([d for d in dirs if d['pos'] is not None], key=lambda d: (d['pos'], d['nome'].lower()))
    cifre = max(2, len(str(len(numerate))))
    for d in dirs:
        d['target'] = d['nome']
    for i, d in enumerate(numerate):
        d['target'] = f"{str(i + 1).zfill(cifre)} - {d['nome']}"


# ── Conto terzi: cartelle Google Drive dei clienti (account robot, sola lettura) ──

GOOGLE = os.path.join(DIR_DATI, 'google.json')
DRIVE = 'https://www.googleapis.com/drive/v3'


def b64url(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=')


def token_google(path=GOOGLE, scope='https://www.googleapis.com/auth/drive'):
    k = json.load(open(path))
    ora = int(time.time())
    msg = b64url(json.dumps({'alg': 'RS256', 'typ': 'JWT'}).encode()) + b'.' + b64url(json.dumps({
        'iss': k['client_email'], 'scope': scope,
        'aud': k['token_uri'], 'iat': ora, 'exp': ora + 3600}).encode())
    # Firma RS256 con l'openssl di sistema: la chiave sta solo un attimo in un file 600
    with tempfile.NamedTemporaryFile('w', dir=DIR_DATI, suffix='.pem', delete=False) as t:
        t.write(k['private_key'])
    try:
        firma = subprocess.run(['/usr/bin/openssl', 'dgst', '-sha256', '-sign', t.name],
                               input=msg, capture_output=True, check=True).stdout
    finally:
        os.unlink(t.name)
    dati = urllib.parse.urlencode({'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                                   'assertion': (msg + b'.' + b64url(firma)).decode()}).encode()
    with urllib.request.urlopen(urllib.request.Request(k['token_uri'], data=dati), timeout=20) as r:
        return json.load(r)['access_token']


def drive_get(tok, url, headers=None):
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {tok}', **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def drive_id(url):
    m = re.search(r'/folders/([\w-]+)', url or '') or re.search(r'[?&]id=([\w-]+)', url or '')
    return m.group(1) if m else (url if re.fullmatch(r'[\w-]{20,}', url or '') else None)


def drive_figli(tok, cartella):
    out, pagina = [], None
    while True:
        q = urllib.parse.urlencode({'q': f"'{cartella}' in parents and trashed=false", 'pageSize': 1000,
                                    'fields': 'nextPageToken,files(id,name,mimeType,size,modifiedTime)',
                                    'supportsAllDrives': 'true', 'includeItemsFromAllDrives': 'true',
                                    **({'pageToken': pagina} if pagina else {})})
        r = json.loads(drive_get(tok, f'{DRIVE}/files?{q}'))
        out += r.get('files', [])
        pagina = r.get('nextPageToken')
        if not pagina:
            return out


CARTELLA_DRIVE = 'application/vnd.google-apps.folder'


def drive_da_guardare(tok, radice):
    """Cartelle da leggere. Se la cartella del cliente è divisa per anni (2025, 2026…) e mesi
    ("11 - Novembre"), solo il mese corrente e il precedente (più una URGENZE in radice): il resto è storico, backup, lavori."""
    figli = drive_figli(tok, radice)
    anni = {f['name'].strip(): f for f in figli if f['mimeType'] == CARTELLA_DRIVE and re.fullmatch(r'20\d\d', f['name'].strip())}
    if not anni:
        return [(radice, '')]
    oggi = datetime.now()
    prima = (oggi.replace(day=1) - timedelta(days=1))
    out = [(f['id'], f['name']) for f in figli if f['mimeType'] == CARTELLA_DRIVE and URGENZE.fullmatch(f['name'].strip())]
    for anno, mese in {(oggi.year, oggi.month), (prima.year, prima.month)}:
        a = anni.get(str(anno))
        if not a:
            continue
        for m in drive_figli(tok, a['id']):
            n = re.match(r'\s*(\d{1,2})', m['name'])
            if m['mimeType'] == CARTELLA_DRIVE and n and int(n.group(1)) == mese:
                out.append((m['id'], f"{anno}/{m['name']}"))
    return out


def drive_files(tok, cartella, percorso='', mese=None):
    mese = mese or cartella   # cartella del mese: lì dentro c'è (o si crea) STAMPATO
    out, pagina = [], None
    while True:
        q = urllib.parse.urlencode({'q': f"'{cartella}' in parents and trashed=false", 'pageSize': 1000,
                                    'fields': 'nextPageToken,files(id,name,mimeType,size,modifiedTime)',
                                    'supportsAllDrives': 'true', 'includeItemsFromAllDrives': 'true',
                                    **({'pageToken': pagina} if pagina else {})})
        r = json.loads(drive_get(tok, f'{DRIVE}/files?{q}'))
        for f in r.get('files', []):
            rel = f"{percorso}/{f['name']}" if percorso else f['name']
            if f['mimeType'] == 'application/vnd.google-apps.folder':
                if not SALTA_DIR.search(f['name']):
                    out += drive_files(tok, f['id'], rel, mese)
            elif EXT.search(f['name']) and not f['mimeType'].startswith('application/vnd.google-apps'):
                out.append({**f, 'percorso': rel, 'parent': cartella, 'mese': mese})
        pagina = r.get('nextPageToken')
        if not pagina:
            return out


class DriveFile:
    """File di Drive letto a pezzi (Range): per le intestazioni bastano pochi KB."""
    BLOCCO = 256 * 1024

    def __init__(self, tok, fid, size):
        self.tok, self.fid, self.size, self.pos, self.blocchi = tok, fid, int(size or 0), 0, {}

    def seek(self, p):
        self.pos = p

    def tell(self):
        return self.pos

    def _blocco(self, i):
        if i not in self.blocchi:
            da = i * self.BLOCCO
            a = min(da + self.BLOCCO, self.size) - 1
            self.blocchi[i] = drive_get(self.tok, f'{DRIVE}/files/{self.fid}?alt=media&supportsAllDrives=true',
                                        {'Range': f'bytes={da}-{a}'}) if a >= da else b''
        return self.blocchi[i]

    def read(self, n=-1):
        fine = self.size if n is None or n < 0 else min(self.size, self.pos + n)
        out = b''
        while self.pos < fine:
            i, off = divmod(self.pos, self.BLOCCO)
            pezzo = self._blocco(i)[off:off + fine - self.pos]
            if not pezzo:
                break
            out += pezzo
            self.pos += len(pezzo)
        return out


def stessa_ora(a, b):
    try:
        p = lambda x: datetime.fromisoformat(str(x).replace('Z', '+00:00')).timestamp()
        return abs(p(a) - p(b)) < 1
    except Exception:
        return False


def drive_scarica(tok, fid, dest):
    """Scarica il file intero in dest (prima .part, poi rinomina: sul NAS non resta mai un file a metà)."""
    tmp = dest + '.part'
    req = urllib.request.Request(f'{DRIVE}/files/{fid}?alt=media&supportsAllDrives=true', headers={'Authorization': f'Bearer {tok}'})
    with urllib.request.urlopen(req, timeout=600) as r, open(tmp, 'wb') as out:
        while True:
            pezzo = r.read(1024 * 1024)
            if not pezzo:
                break
            out.write(pezzo)
    os.replace(tmp, dest)


def drive_stampato(tok, mese, cache):
    """Id della cartella STAMPATO dentro la cartella del mese (la crea se manca)."""
    if mese in cache:
        return cache[mese]
    for f in drive_figli(tok, mese):
        if f['mimeType'] == CARTELLA_DRIVE and SALTA_DIR.search(f['name']):
            cache[mese] = f['id']
            return f['id']
    req = urllib.request.Request(f'{DRIVE}/files?supportsAllDrives=true', method='POST',
                                 data=json.dumps({'name': 'STAMPATO', 'mimeType': CARTELLA_DRIVE, 'parents': [mese]}).encode(),
                                 headers={'Authorization': f'Bearer {tok}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        cache[mese] = json.load(r)['id']
    return cache[mese]


def drive_sposta(tok, f, stampato):
    req = urllib.request.Request(
        f"{DRIVE}/files/{f['id']}?addParents={stampato}&removeParents={f['parent']}&supportsAllDrives=true&fields=id",
        method='PATCH', data=b'{}', headers={'Authorization': f'Bearer {tok}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30):
        pass


def cartella_cliente(cartella_nas, nome):
    """Cartella del cliente in 1. Stampare (anche col numero davanti, es. "01 - K1"); se manca la crea."""
    for n in os.listdir(cartella_nas):
        if os.path.isdir(os.path.join(cartella_nas, n)) and base(n).strip().lower() == nome.strip().lower():
            return os.path.join(cartella_nas, n)
    p = os.path.join(cartella_nas, nome.strip())
    os.makedirs(p, exist_ok=True)
    return p


def nome_libero(cartella, nome, size):
    """Nome per la copia: se c'è già un file diverso con lo stesso nome, aggiunge (2), (3)…"""
    radice, ext = os.path.splitext(nome)
    p, k = os.path.join(cartella, nome), 2
    while os.path.exists(p) and os.path.getsize(p) != size:
        p, k = os.path.join(cartella, f'{radice} ({k}){ext}'), k + 1
    return p


def conto_terzi(cfg, roll, gap, prova, cartella_nas, stato, forza=False):
    """Alle 5 e poi ogni ora fino alle 14, nei giorni lavorativi: i file nuovi della cartella Drive
    del cliente vanno in 1. Stampare/<cliente> sul NAS, si contano nel conto terzi di oggi e su Drive
    passano in STAMPATO. Nei giorni di stampa del cliente (di solito mar e gio) tutti i file; negli
    altri giorni lavorativi solo quelli nelle cartelle URGENZE. Il resto aspetta il giorno di stampa."""
    if not os.path.exists(GOOGLE) or not os.path.isdir(cartella_nas):
        return
    ora = datetime.now()
    if not forza and not (5 <= ora.hour <= 14):
        return
    dati = rpc(cfg, 'tc_dtf_ct_dati', {'p_chiave': cfg['chiave']})
    if not dati.get('success') or not dati.get('clienti') or not (dati.get('lavorativo') or forza):
        return
    noti = dati.get('files') or {}
    fatte = stato.setdefault('ct_ore', {})
    giro = ora.strftime('%Y-%m-%d %H')
    tok = None
    for c in dati['clienti']:
        if not forza and fatte.get(c['id']) == giro:
            continue
        solo_urgenze = not forza and ora.isoweekday() not in (c.get('giorni') or [2, 4])
        cartella = drive_id(c.get('drive_url'))
        if not cartella:
            print(f"  conto terzi {c['nome']}: link della cartella non valido", file=sys.stderr)
            continue
        tok = tok or token_google()
        try:
            files = [f for cid, rel in drive_da_guardare(tok, cartella) for f in drive_files(tok, cid, rel)]
        except urllib.error.HTTPError as e:
            print(f"  conto terzi {c['nome']}: cartella non leggibile ({e.code}): è condivisa con l'account robot?", file=sys.stderr)
            continue
        if solo_urgenze:
            files = [f for f in files if any(URGENZE.fullmatch(p.strip()) for p in f['percorso'].split('/')[:-1])]

        # Da copiare: i file mai contati (o cambiati dopo il conteggio)
        def contato(f):
            n = noti.get(f['id'])
            return bool(n and n.get('contato') and int(n.get('size') or -1) == int(f.get('size') or 0)
                        and stessa_ora(n.get('modificato'), f['modifiedTime']))
        nuovi = [f for f in files if not contato(f)]
        copiati = []
        if nuovi:
            dest = None if prova else cartella_cliente(cartella_nas, c['nome'])
            for f in nuovi:
                if prova:
                    print(f"  conto terzi {c['nome']}: copierei {f['percorso']} in 1. Stampare/{c['nome']}")
                    continue
                p = nome_libero(dest, f['name'], int(f.get('size') or 0))
                try:
                    if not (os.path.exists(p) and os.path.getsize(p) == int(f.get('size') or 0)):
                        drive_scarica(tok, f['id'], p)
                except Exception as e:
                    print(f"  conto terzi {c['nome']}: {f['percorso']} non copiato: {e}", file=sys.stderr)
                    continue
                item = descrivi(p, f['name'], roll, gap)
                copiati.append({'drive_id': f['id'], 'nome': f['name'], 'percorso': f['percorso'],
                                'size': int(f.get('size') or 0), 'modificato': f['modifiedTime'], 'item': item, '_f': f})
                print(f"  conto terzi {c['nome']}: copiato {f['percorso']} ({item.get('metri')} m)")
            if copiati:
                r = rpc(cfg, 'tc_dtf_ct_copiati', {'p_chiave': cfg['chiave'], 'p_client': c['id'],
                                                   'p_files': [{k: v for k, v in x.items() if k != '_f'} for x in copiati]})
                if not r.get('success'):
                    print(f"  conto terzi {c['nome']}: conteggio non salvato: {r.get('error')}", file=sys.stderr)
                    continue   # non si sposta niente su Drive: al prossimo giro si riprova
                print(f"  conto terzi {c['nome']}: {r.get('contati')} file, {r.get('metri')} m nel conto terzi di oggi")

        # Su Drive in STAMPATO: i file appena contati e quelli contati prima ma rimasti fuori (spostamento non riuscito)
        da_spostare = [x['_f'] for x in copiati] + [f for f in files if contato(f)]
        cache = {}
        for f in da_spostare:
            if prova:
                print(f"  conto terzi {c['nome']}: sposterei {f['percorso']} in STAMPATO")
                continue
            try:
                drive_sposta(tok, f, drive_stampato(tok, f['mese'], cache))
            except Exception as e:
                print(f"  conto terzi {c['nome']}: {f['percorso']} non spostato in STAMPATO: {e}", file=sys.stderr)
        if not prova:
            fatte[c['id']] = giro


# ── Ordini nuovi con DTF: file dalla cartella del cliente a 1. Stampare ──

def cartelle_clienti(dati_root):
    """(nome, percorso) delle cartelle cliente: DATI/Clienti/<iniziale>/<cliente> e DATI/CrossFit/<box>."""
    out = []
    clienti = os.path.join(dati_root, 'Clienti')
    if os.path.isdir(clienti):
        for lettera in os.listdir(clienti):
            pl = os.path.join(clienti, lettera)
            if len(lettera) <= 2 and os.path.isdir(pl):
                out += [(n, os.path.join(pl, n)) for n in os.listdir(pl) if not salta(n) and os.path.isdir(os.path.join(pl, n))]
    box = os.path.join(dati_root, 'CrossFit')
    if os.path.isdir(box):
        out += [(n, os.path.join(box, n)) for n in os.listdir(box) if not salta(n) and os.path.isdir(os.path.join(box, n))]
    return out


def trova_cliente(o, cartelle):
    """Cartella del cliente dell'ordine: nome uguale (cliente, poi ordine), altrimenti una sola molto simile."""
    nomi = [n for n in (o.get('cliente'), o.get('nome')) if n]
    for nome in nomi:
        k = core(nome)
        uguali = [p for n, p in cartelle if len(k) >= 3 and core(n) == k]
        if len(uguali) == 1:
            return uguali[0]
    for nome in nomi:
        k = core(nome)
        # il più corto deve coprire almeno due terzi del più lungo ("Padel" non è "Padel Hero")
        simili = [p for n, p in cartelle if len(k) >= 4 and len(core(n)) >= 4 and (core(n) in k or k in core(n))
                  and min(len(k), len(core(n))) * 3 >= max(len(k), len(core(n))) * 2]
        if len(simili) == 1:
            return simili[0]
    return None


def _cartella_dtf_tiff(cartella):
    """<cartella>/dtf/tiff (va bene anche "01-dtf", "tif"); None se non c'è."""
    for d in sorted(os.listdir(cartella)):
        pd = os.path.join(cartella, d)
        if os.path.isdir(pd) and re.search(r'dtf', d, re.I) and not SALTA_DIR.search(d):
            for t in sorted(os.listdir(pd)):
                pt = os.path.join(pd, t)
                if os.path.isdir(pt) and re.fullmatch(r'tiff?', t.strip(), re.I):
                    return pt
    return None


def file_dtf_cliente(cartella, descr=None):
    """Schema delle cartelle (deciso 2026-11-19):
         <cliente>/<anno>/dtf/tiff/                → ordine senza descrizione
         <cliente>/<anno>/<lavorazione>/dtf/tiff/  → ordine con descrizione = <lavorazione>
    Anno corrente; solo i file direttamente in tiff (pronti da stampare). Se la descrizione non
    corrisponde a nessuna sottocartella si usa <anno>/dtf/tiff. Ritorna (file, cartella usata)."""
    anno = os.path.join(cartella, str(datetime.now().year))
    if not os.path.isdir(anno):
        return [], None
    tiff = None
    if descr and descr.strip():
        sotto = [(d, os.path.join(anno, d)) for d in os.listdir(anno)
                 if os.path.isdir(os.path.join(anno, d)) and not salta(d) and not re.search(r'dtf', d, re.I) and not SALTA_DIR.search(d)]
        k = core(descr)
        uguali = [p for d, p in sotto if core(d) == k]
        simili = [p for d, p in sotto if len(k) >= 4 and len(core(d)) >= 4 and (core(d) in k or k in core(d))
                  and min(len(k), len(core(d))) * 3 >= max(len(k), len(core(d))) * 2]
        scelta = uguali if len(uguali) == 1 else simili if len(simili) == 1 else []
        if scelta:
            tiff = _cartella_dtf_tiff(scelta[0])
    tiff = tiff or _cartella_dtf_tiff(anno)
    if not tiff:
        return [], None
    files = [os.path.join(tiff, n) for n in sorted(os.listdir(tiff))
             if not salta(n) and EXT.search(n) and os.path.isfile(os.path.join(tiff, n))]
    return files, tiff


def nome_con_pz(nome, pz):
    """Nome del file in 1. Stampare: "<nome>-<pz>pz"; se il nome ha già i pezzi, li sostituisce."""
    if not pz or pz < 1:
        return nome
    if parse_pz(nome)[1]:
        return re.sub(r'(\d+)(\s*pz)', lambda m: f'{pz}{m.group(2)}', nome, count=1, flags=re.I)
    radice, ext = os.path.splitext(nome)
    return f'{radice}-{pz}pz{ext}'


def copia_ordine(cartella_nas, dati_root, nome_ordine, files):
    """files: [{src (relativo a DATI), pz}] → 1. Stampare/<NOME ORDINE>. Ritorna la cartella."""
    dest = os.path.join(cartella_nas, nome_ordine.replace('/', '-').strip())
    os.makedirs(dest, exist_ok=True)
    for f in files:
        src = os.path.normpath(os.path.join(dati_root, f['src']))
        if not src.startswith(dati_root + os.sep):   # solo file dentro DATI
            raise ValueError(f"percorso non valido: {f['src']}")
        fin = os.path.join(dest, nome_con_pz(os.path.basename(src), int(f.get('pz') or 0)))
        if not os.path.exists(fin):
            shutil.copyfile(src, fin + '.part')
            os.replace(fin + '.part', fin)
    return dest


def prepara_ordini(cfg, dati, cartella_nas, prova, stato):
    """Ordini nuovi con DTF. In modalità 'prova' (default) salva solo una PROPOSTA da riscontrare
    in DTF interno e copia le proposte approvate; in 'automatica' copia subito.
    Il modo lo cambia una persona (app_settings dtf_prepara_modo), mai lo script."""
    modo = dati.get('prepara_modo') or 'prova'
    da, approvati = dati.get('da_preparare') or [], dati.get('approvati') or []
    if not da and not approvati:
        return
    dati_root = os.path.normpath(os.path.join(cartella_nas, '..', '..', '..'))

    def registra(o, esito, dest=None, sorgente=None, n=0, proposta=None):
        if not prova:
            rpc(cfg, 'tc_dtf_preparato', {'p_chiave': cfg['chiave'], 'p_order': o['id'], 'p_esito': esito, 'p_cartella': dest,
                                          'p_sorgente': sorgente, 'p_files': n, 'p_proposta': proposta})

    # Proposte approvate in DTF interno: si copiano i file scelti (con i pezzi corretti)
    for o in approvati:
        if prova:
            print(f"  ordine {o['nome']}: copierei i {len(o['files'] or [])} file approvati")
            continue
        try:
            dest = copia_ordine(cartella_nas, dati_root, o['nome'], o['files'] or [])
            registra(o, 'copiato', dest, None, len(o['files'] or []))
            print(f"  ordine {o['nome']}: {len(o['files'] or [])} file approvati copiati")
        except Exception as e:
            print(f"  ordine {o['nome']}: file approvati non copiati: {e}", file=sys.stderr)

    if not da:
        return
    cartelle = cartelle_clienti(dati_root)
    avvisati = stato.setdefault('prepara_avvisi', {})
    for o in da:
        # Cartella già in 1. Stampare (messa a mano): non si tocca
        def di_altri(n):
            oid = proprietario(n, [x for x in (dati.get('lista') or []) if not x.get('cartella')], dati.get('items') or {}, dati.get('preparati'))
            return oid is not None and oid != o['id']
        if any(os.path.isdir(os.path.join(cartella_nas, n)) and core(base(n)) == core(o['nome']) and not di_altri(n)
               for n in os.listdir(cartella_nas)):
            registra(o, 'gia_presente')
            continue
        cli = trova_cliente(o, cartelle)
        files, da_dove = file_dtf_cliente(cli, o.get('descr')) if cli else ([], None)
        if not files:
            motivo = 'cliente_non_trovato' if not cli else 'nessun_file'
            if avvisati.get(o['id']) != motivo:   # si riprova ogni giro (il file può arrivare dopo), avviso una volta
                print(f"  ordine {o['nome']}: {'cartella cliente non trovata' if not cli else 'nessun file in ' + os.path.relpath(cli, dati_root) + '/<anno>/…/dtf/tiff'}")
                avvisati[o['id']] = motivo
            continue
        capi = int(o.get('capi') or 0)
        # pezzi: quelli scritti nel nome del file dal grafico, altrimenti il totale capi dell'ordine
        def pz_di(f):
            n, scritti = parse_pz(os.path.basename(f))
            return n if scritti else capi
        proposta = [{'src': os.path.relpath(f, dati_root), 'nome': nome_con_pz(os.path.basename(f), pz_di(f)), 'pz': pz_di(f)} for f in files]
        sorgente = os.path.relpath(da_dove, dati_root)
        if modo == 'automatica':
            if prova:
                print(f"  ordine {o['nome']}: copierei {len(files)} file da {sorgente}")
                continue
            dest = copia_ordine(cartella_nas, dati_root, o['nome'], proposta)
            registra(o, 'copiato', dest, sorgente, len(files), proposta)
            print(f"  ordine {o['nome']}: {len(files)} file DTF copiati da {sorgente}")
        else:
            registra(o, 'proposta', None, sorgente, len(files), proposta)
            print(f"  ordine {o['nome']}: proposta di {len(files)} file da {sorgente}, da approvare in DTF interno")
        avvisati.pop(o['id'], None)


def leggi_config():
    """config.json: url/anon/chiave, oppure "env" = file .env con CS_SUPABASE_URL, CS_ANON_KEY,
    CS_AUTOMAZIONE_KEY (sul Mac mini quello dello script del mattino: la chiave non si copia).
    Facoltativi: "cartella" (1. Stampare), "nas" (collegamento), "conto_terzi" (false = spento)."""
    with open(CONFIG) as f:
        cfg = json.load(f)
    if cfg.get('env'):
        env = {}
        with open(os.path.expanduser(cfg['env'])) as f:
            for riga in f:
                if '=' in riga and not riga.lstrip().startswith('#'):
                    k, v = riga.split('=', 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
        cfg.setdefault('url', env.get('CS_SUPABASE_URL'))
        cfg.setdefault('anon', env.get('CS_ANON_KEY'))
        cfg.setdefault('chiave', env.get('CS_AUTOMAZIONE_KEY'))
    return cfg


def monta_nas(nas):
    """Collega la condivisione del NAS per questo utente (es. ~/NAS/DATI) se non è già collegata.
    nas: { server, share, mount, credenziali } — credenziali = file con utente e password (600)."""
    mount = os.path.expanduser(nas['mount'])
    if os.path.ismount(mount):
        return
    os.makedirs(mount, exist_ok=True)
    with open(os.path.expanduser(nas['credenziali'])) as f:
        utente, _, password = f.read().partition('\n')
    url = f"//{urllib.parse.quote(utente.strip(), safe='')}:{urllib.parse.quote(password.strip(), safe='')}@{nas['server']}/{nas['share']}"
    r = subprocess.run(['/sbin/mount_smbfs', '-N', url, mount], capture_output=True, text=True)
    if r.returncode != 0:
        print('NAS non collegato:', (r.stderr or '').replace(password.strip(), '***').strip(), file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--prova', action='store_true')
    ap.add_argument('--cartella', default=CARTELLA)
    ap.add_argument('--conto-terzi-ora', action='store_true',
                    help='conto terzi subito, anche fuori dai giorni e dagli orari di stampa')
    a = ap.parse_args()

    cfg = leggi_config()

    # Un giro alla volta: se il precedente sta ancora copiando, questo salta
    os.makedirs(DIR_DATI, exist_ok=True)
    blocco = open(os.path.join(DIR_DATI, 'giro.lock'), 'w')
    try:
        fcntl.flock(blocco, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return 0

    if cfg.get('nas'):
        monta_nas(cfg['nas'])
    if cfg.get('cartella') and a.cartella == CARTELLA:
        a.cartella = cfg['cartella']

    dati = rpc(cfg, 'tc_dtf_cartella_dati', {'p_chiave': cfg['chiave']})
    if not dati.get('success'):
        print('dati non letti:', dati.get('error'), file=sys.stderr)
        return 1
    lista = dati.get('lista') or []
    items_db = dati.get('items') or {}
    roll = float(dati.get('roll_cm') or 57)
    gap = float(dati.get('margin_cm') if dati.get('margin_cm') is not None else 0.5)

    if not os.path.isdir(a.cartella):
        return 0   # NAS non montato: si riprova al prossimo giro

    try:
        with open(STATO) as f:
            stato = json.load(f)
    except Exception:
        stato = {}

    # Conto terzi: dal Drive del cliente alla sua cartella in 1. Stampare (prima di leggere la cartella)
    try:
        if cfg.get('conto_terzi', True) or a.conto_terzi_ora:
            conto_terzi(cfg, roll, gap, a.prova, a.cartella, stato, a.conto_terzi_ora)
    except Exception as e:
        print('conto terzi:', e, file=sys.stderr)

    # Ordini nuovi con DTF: file dalla cartella del cliente
    try:
        prepara_ordini(cfg, dati, a.cartella, a.prova, stato)
    except Exception as e:
        print('ordini da preparare:', e, file=sys.stderr)

    escluse = {c['nome'].strip().lower() for c in dati.get('ct_clienti') or []}

    # File sciolti dello stesso ordine in una cartella
    sciolti_spostati, sciolti_errori = [], []
    try:
        sciolti_spostati, sciolti_errori = raggruppa_sciolti(a.cartella, a.prova, escluse)
    except Exception as e:
        sciolti_errori.append(f'file sciolti: {e}')

    # File con la colla nera (leggings, short, soft shell) nella cartella COLLA NERA
    colla_spostati, colla_errori = [], []
    try:
        colla_spostati, colla_errori = sposta_colla_nera(a.cartella, a.prova, escluse)
    except Exception as e:
        colla_errori.append(f'colla nera: {e}')

    # La lista ha gli ordini e, al loro posto, le cartelle senza ordine ({id: 'cartella:<nome>', cartella: true})
    pos = {o['id']: i for i, o in enumerate(lista)}
    ordini_lista = [o for o in lista if not o.get('cartella')]

    gruppi = gruppi_di(a.cartella)
    # PDF → TIF chiesti dal task "Creare il file TIF"
    tiff_righe = []
    try:
        tiff_righe, cambiato = genera_tiff(dati.get('tiff_richieste'), gruppi, stato, a.prova)
        if cambiato:
            gruppi = gruppi_di(a.cartella)
    except Exception as e:
        tiff_righe.append(f'ERRORE tiff: {e}')
    per_ordine, senza, ambigue = {}, [], []
    misure = stato.get('misure') or {}   # cache delle misure dei file senza ordine: percorso → [size, mtime, metri]
    ct_clienti = dati.get('ct_clienti') or []
    for g in gruppi:
        # Cartella di un cliente conto terzi (es. "K1", copiata da Drive): in cima, niente task
        ct = next((c for c in ct_clienti if g.get('dir') and g['nome'].strip().lower() == c['nome'].strip().lower()), None)
        if ct:
            g.update({'ordine': None, 'ct': ct['id'], 'pos': pos.get('ct:' + ct['id'], -1)})
            continue
        o = abbina(g['nome'], ordini_lista)
        if o == 'ambiguo':   # ordini con lo stesso nome: decide chi ha già la cartella
            fc = core(g['nome'])
            pari = [x for x in ordini_lista if len(core(x.get('nome'))) >= 4 and (core(x.get('nome')) in fc or fc in core(x.get('nome')))]
            oid = proprietario(g.get('dir') or g['nome'], pari, items_db, dati.get('preparati'))
            o = next((x for x in ordini_lista if x['id'] == oid), 'ambiguo')
        g['ordine'] = o['id'] if o and o != 'ambiguo' else None
        g['pos'] = pos[o['id']] if g['ordine'] else pos.get('cartella:' + g['nome'])
        if o == 'ambiguo':
            ambigue.append(g['nome'])
        elif not o:
            if g['files']:
                senza.append(g['nome'])
        elif g['files']:
            per_ordine.setdefault(o['id'], []).extend(g['files'])

    # COLLA NERA resta una riga sua nella coda (si stampa tutta insieme), ma i file spostati dagli ordini
    # restano anche sui loro ordini: il percorso segue il file e l'ordine non va in "controllare se stampato"
    # metriOrdini: metri di quei file per ordine, che il gestionale toglie dal totale (contati una volta sola)
    for g in gruppi:
        if g.get('dir') and not g['ordine'] and COLLA_DIR.fullmatch(g['nome'].strip()):
            g['metriOrdini'] = {}
            for fl in g['files']:
                st = os.stat(fl['abs'])
                oid, it = next(((o['id'], x) for o in ordini_lista for x in (items_db.get(o['id']) or [])
                                if stesso_file(fl, x, st)), (None, None))
                if oid:
                    per_ordine.setdefault(oid, []).append(fl)
                    g['metriOrdini'][oid] = round(g['metriOrdini'].get(oid, 0) + (it.get('metri') or 0), 2)

    # Metri delle cartelle senza ordine (per la coda DTF), riletti solo se il file cambia
    nuove_misure = {}
    for g in gruppi:
        if g['ordine'] or not g['files']:
            continue
        tot = 0
        for fl in g['files']:
            st = os.stat(fl['abs'])
            k, firma = chiave(fl['path']), [st.st_size, int(st.st_mtime * 1000)]
            m = misure.get(k)
            metri = m[2] if m and m[:2] == firma else descrivi(fl['abs'], fl['name'], roll, gap).get('metri')
            nuove_misure[k] = firma + [metri]
            tot += metri or 0
        g['metri'] = round(tot, 2)
    stato['misure'] = nuove_misure

    # File e metri sugli ordini
    ordini, aggiunti = [], 0
    for oid, files in per_ordine.items():
        items, n, cambiati = aggiorna_items(items_db.get(oid) or [], files, roll, gap)
        aggiunti += n
        if cambiati:
            ordini.append({'id': oid, 'items': items})
            nome = next(o['nome'] for o in lista if o['id'] == oid)
            print(f"  {nome}: {len(items)} file, {round(sum(x.get('metri') or 0 for x in items), 2)} m"
                  + (f', {n} nuovi' if n else ''))

    # Numeri davanti alle cartelle: DTF nuovi o richiesta dal gestionale
    percorsi = sorted(chiave(fl['path']) for g in gruppi for fl in g['files'])
    richiesta = (dati.get('richiesta') or {}).get('at')
    primo_giro = 'visti' not in stato   # prima lettura: si registra com'è, senza rinominare niente
    nuovi = set() if primo_giro else set(percorsi) - set(stato.get('visti') or [])
    chiesta = bool(richiesta) and richiesta != stato.get('richiesta') and not primo_giro
    dirs = [g for g in gruppi if not g.get('sciolto')]
    numera(dirs)
    da_rinominare = [(d, d['target']) for d in dirs if d['target'] != d['dir']]
    rinominate, errori = [], list(sciolti_errori) + list(colla_errori)
    if (nuovi or chiesta) and da_rinominare:
        for d, nuovo in da_rinominare:
            if a.prova:
                rinominate.append(f"{d['dir']} → {nuovo}")
                continue
            dest = os.path.join(a.cartella, nuovo)
            if os.path.exists(dest):
                errori.append(f"{d['dir']} → {nuovo}: esiste già")
                continue
            try:
                os.rename(os.path.join(a.cartella, d['dir']), dest)
                rinominate.append(f"{d['dir']} → {nuovo}")
                d['dir'] = nuovo
            except OSError as e:
                errori.append(f"{d['dir']} → {nuovo}: {e.strerror}")
    # I percorsi dei file seguono il nome nuovo della cartella
    for o in ordini:
        for x in o['items']:
            if x.get('cartella'):
                d = next((d for d in dirs if chiave(x['cartella']).startswith(d['nome'] + '/')), None)
                if d:
                    x['cartella'] = d['dir'] + '/' + x['cartella'].split('/', 1)[1]

    attesa = sum(1 for d in dirs if d['target'] != d['dir'])
    # Ordini che avevano la cartella (file con 'cartella') e ora non ce l'hanno più: controllare se stampati
    mancanti = [o['id'] for o in ordini_lista if o['id'] not in per_ordine
                and any(x.get('cartella') for x in (items_db.get(o['id']) or []))]
    cartelle = [{'nome': g['nome'], 'dir': g.get('dir'), 'ordine': g['ordine'], 'files': len(g['files']),
                 **({'ct': g['ct']} if g.get('ct') else {}),
                 **({'metriOrdini': g['metriOrdini']} if g.get('metriOrdini') else {}),
                 **({'metri': g.get('metri', 0)} if not g['ordine'] else {})} for g in gruppi if g['files'] or g.get('dir')]
    # PDF senza TIF per cartella (task "Creare il file TIF"), con l'errore dell'ultima conversione
    pdf = [{'nome': g['nome'], 'dir': g.get('dir'), 'files': [f['path'].split('/', 1)[-1] for f in ps],
            **({'errore': stato['tiff_errori'][g['nome']]} if (stato.get('tiff_errori') or {}).get(g['nome']) else {})}
           for g in gruppi for ps in [pdf_senza_tif(g['files'])] if ps]
    esito = {'at': datetime.now(timezone.utc).isoformat(), 'abbinate': len(per_ordine), 'aggiunti': aggiunti,
             'collaNera': len(colla_spostati), 'raggruppati': len(sciolti_spostati), 'pdf': pdf,
             'senzaOrdine': senza, 'ambigue': ambigue, 'rinominate': len(rinominate), 'attesa': attesa,
             'errori': errori, 'cartelle': cartelle, 'mancanti': mancanti}
    for r in sciolti_spostati:
        print('  raggruppa', r)
    for r in tiff_righe:
        print(' ', r)
    for r in colla_spostati:
        print('  colla nera', r)
    for r in rinominate:
        print('  rinomina', r)
    for e in errori:
        print('  ERRORE', e, file=sys.stderr)
    if a.prova:
        print(json.dumps({**esito, 'ordini_da_salvare': len(ordini), 'nuovi': len(nuovi), 'richiesta': chiesta},
                         ensure_ascii=False, indent=1))
        return 0

    # Esito al gestionale solo se cambia qualcosa, o ogni 10 minuti per dire "sono attivo"
    # (ogni salvataggio ridisegna i gestionali aperti)
    firma = json.dumps({k: v for k, v in esito.items() if k != 'at'}, sort_keys=True, ensure_ascii=False)
    ora = datetime.now(timezone.utc).timestamp()
    if ordini or firma != stato.get('firma') or ora - (stato.get('salvato') or 0) >= 600:
        r = rpc(cfg, 'tc_dtf_cartella_salva', {'p_chiave': cfg['chiave'], 'p_ordini': ordini, 'p_stato': esito})
        if not r.get('success'):
            print('non salvato:', r.get('error'), file=sys.stderr)
            return 1
        stato.update({'firma': firma, 'salvato': ora})
    os.makedirs(DIR_DATI, exist_ok=True)
    with open(STATO, 'w') as f:
        json.dump({**stato, 'visti': percorsi, 'richiesta': richiesta}, f)

    if rinominate or errori or aggiunti or colla_spostati or sciolti_spostati or tiff_righe:   # registro del Centro di controllo solo quando cambia qualcosa
        try:
            ini = rpc(cfg, 'tc_automazione_inizio', {'p_chiave': cfg['chiave'], 'p_nome': 'dtf-cartella'})
            if ini.get('success'):
                righe = ([f'{aggiunti} file nuovi su {len(ordini)} ordini'] + [f'raggruppato: {r}' for r in sciolti_spostati]
                         + tiff_righe + [f'colla nera: {r}' for r in colla_spostati]
                         + rinominate + [f'ERRORE {e}' for e in errori])
                rpc(cfg, 'tc_automazione_fine', {
                    'p_chiave': cfg['chiave'], 'p_id': ini['id'], 'p_stato': 'errore' if errori or any(r.startswith('ERRORE') for r in tiff_righe) else 'ok',
                    'p_riepilogo': {'file_nuovi': aggiunti, 'colla_nera': len(colla_spostati), 'raggruppati': len(sciolti_spostati),
                                    'tiff': sum(1 for r in tiff_righe if not r.startswith('ERRORE')), 'rinominate': len(rinominate),
                                    'errori': len(errori)},
                    'p_output': '\n'.join(righe)})
        except Exception as e:
            print('registro non scritto:', e, file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
