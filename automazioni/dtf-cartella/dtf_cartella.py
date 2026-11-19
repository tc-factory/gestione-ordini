#!/usr/bin/python3
"""T&C Factory — cartella DTF "1. Stampare" sul NAS → gestionale.

Gira ogni minuto sul Mac mini (launchd, vedi installa.zsh), così funziona per tutti i PC,
anche Windows, senza collegare niente nel browser:
  • abbina ogni sottocartella a un ordine della lista DTF interno → Da stampare
    (la lista la pubblica il gestionale in app_settings 'dtf_lista', già in ordine);
  • legge misura e pezzi dei file nuovi e scrive file e metri sull'ordine;
  • quando arriva un DTF nuovo, o col bottone "Numera ora", mette davanti alle cartelle
    il numero dell'ordine nella lista ("01 - cf pavia").
Le cartelle "Stampato" sono escluse; i file sciolti si abbinano col loro nome e non si rinominano.
Non toglie mai file dagli ordini (quelli spostati in Stampato restano nei metri).
Stesse regole di js/dtf-misure.js e js/dtf-cartella.js. Solo libreria standard.

Uso:  dtf_cartella.py [--prova] [--cartella PERCORSO]
  --prova  legge e stampa cosa farebbe, senza scrivere né rinominare

Config (fuori dal repository, il repo è pubblico):
  ~/Library/Application Support/TC DTF/config.json  { "url", "anon", "chiave" }
"""
import argparse
import json
import math
import os
import re
import struct
import sys
import unicodedata
import urllib.request
from datetime import datetime, timezone

CARTELLA = '/Volumes/DATI/DTF/1. Stampa/1. Stampare'
DIR_DATI = os.path.expanduser('~/Library/Application Support/TC DTF')
CONFIG = os.path.join(DIR_DATI, 'config.json')
STATO = os.path.join(DIR_DATI, 'stato.json')

EXT = re.compile(r'\.(tiff?|pdf|png|jpe?g)$', re.I)
SALTA_DIR = re.compile(r'stampato', re.I)
NUMERO = re.compile(r'^\d{1,3}\s*-\s*')
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


def leggi_misura(path):
    name = path.lower()
    try:
        with open(path, 'rb') as f:
            if name.endswith('.pdf'):
                return leggi_pdf(f)
            if re.search(r'\.tiff?$', name):
                return leggi_tif(f)
            if name.endswith('.png'):
                return leggi_png(f)
            if re.search(r'\.jpe?g$', name):
                return leggi_jpg(f)
    except Exception as e:
        print(f'  illeggibile {path}: {e}', file=sys.stderr)
        return {'fonte': 'illeggibile'}
    return {'fonte': 'formato'}


def descrivi(path, name, roll, gap):
    pz, trovati = parse_pz(name)
    f = {'name': name, 'pz': pz, 'pz_trovati': trovati, **leggi_misura(path)}
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
    return items, aggiunti, cambiati


# Nome giusto di ogni cartella in d['target']; quelle senza ordine perdono il numero
def numera(dirs):
    numerate = sorted([d for d in dirs if d['pos'] is not None], key=lambda d: (d['pos'], d['nome'].lower()))
    cifre = max(2, len(str(len(numerate))))
    for d in dirs:
        d['target'] = d['nome']
    for i, d in enumerate(numerate):
        d['target'] = f"{str(i + 1).zfill(cifre)} - {d['nome']}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--prova', action='store_true')
    ap.add_argument('--cartella', default=CARTELLA)
    a = ap.parse_args()

    if not os.path.isdir(a.cartella):
        return 0   # NAS non montato: si riprova al prossimo giro
    with open(CONFIG) as f:
        cfg = json.load(f)
    dati = rpc(cfg, 'tc_dtf_cartella_dati', {'p_chiave': cfg['chiave']})
    if not dati.get('success'):
        print('dati non letti:', dati.get('error'), file=sys.stderr)
        return 1
    lista = dati.get('lista') or []
    items_db = dati.get('items') or {}
    roll = float(dati.get('roll_cm') or 57)
    gap = float(dati.get('margin_cm') if dati.get('margin_cm') is not None else 0.5)
    pos = {o['id']: i for i, o in enumerate(lista)}

    try:
        with open(STATO) as f:
            stato = json.load(f)
    except Exception:
        stato = {}

    gruppi = gruppi_di(a.cartella)
    per_ordine, senza, ambigue = {}, [], []
    for g in gruppi:
        if not g['files'] and g.get('sciolto'):
            continue
        o = abbina(g['nome'], lista)
        g['pos'] = pos[o['id']] if o and o != 'ambiguo' else None
        if o == 'ambiguo':
            ambigue.append(g['nome'])
        elif not o:
            if g['files']:
                senza.append(g['nome'])
        elif g['files']:
            per_ordine.setdefault(o['id'], []).extend(g['files'])

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
    nuovi = set(percorsi) - set(stato.get('visti') or [])
    richiesta = (dati.get('richiesta') or {}).get('at')
    chiesta = bool(richiesta) and richiesta != stato.get('richiesta')
    dirs = [g for g in gruppi if not g.get('sciolto')]
    numera(dirs)
    da_rinominare = [(d, d['target']) for d in dirs if d['target'] != d['dir']]
    rinominate, errori = [], []
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
    esito = {'at': datetime.now(timezone.utc).isoformat(), 'abbinate': len(per_ordine), 'aggiunti': aggiunti,
             'senzaOrdine': senza, 'ambigue': ambigue, 'rinominate': len(rinominate), 'attesa': attesa,
             'errori': errori}
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

    if rinominate or errori or aggiunti:   # registro del Centro di controllo solo quando cambia qualcosa
        try:
            ini = rpc(cfg, 'tc_automazione_inizio', {'p_chiave': cfg['chiave'], 'p_nome': 'dtf-cartella'})
            if ini.get('success'):
                righe = [f'{aggiunti} file nuovi su {len(ordini)} ordini'] + rinominate + [f'ERRORE {e}' for e in errori]
                rpc(cfg, 'tc_automazione_fine', {
                    'p_chiave': cfg['chiave'], 'p_id': ini['id'], 'p_stato': 'errore' if errori else 'ok',
                    'p_riepilogo': {'file_nuovi': aggiunti, 'rinominate': len(rinominate), 'errori': len(errori)},
                    'p_output': '\n'.join(righe)})
        except Exception as e:
            print('registro non scritto:', e, file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
