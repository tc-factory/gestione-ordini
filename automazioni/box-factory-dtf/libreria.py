#!/usr/bin/env python3
"""Libreria delle grafiche DTF di Box Factory Lab: dai TIF originali ricava file puliti e uniformi.

Per ogni originale:
- tiene una sola copia della grafica (molti originali sono fogli con 2 o 3 copie affiancate);
- porta i colori in CMYK Coated FOGRA39 (gli RGB sono convertiti con il loro profilo, sRGB se manca);
- i neri, ricchi o quasi neri, diventano 0/0/0/100;
- toglie lo SPOT: la forma della grafica resta come trasparenza (canale alfa), lo spot si rifà nel foglio di stampa;
- ritaglia ai bordi della grafica, 8 bit, 300 dpi.

Gli originali non si toccano. Uso:
  python libreria.py ORIGINALI DESTINAZIONE [--profilo FOGRA39.icc] [--solo nome.tif ...]
Scrive anche DESTINAZIONE/libreria.csv con le misure e le note da controllare.
"""
import argparse
import csv
import io
import sys
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image, ImageCms

DPI = 300
# Un pixel è "nero" se, simulato a video, nessun canale supera il 12% ed è quasi neutro
SOGLIA_NERO = 0.12
SOGLIA_NEUTRO = 0.07
# Copie affiancate (anche attaccate): si cercano solo negli originali più larghi di 30 cm
LARGHEZZA_COPIE_CM = 30
# Differenza media tra le forme sovrapposte: le copie vere stanno sotto 0,10, le grafiche singole sopra 0,30
DIFFERENZA_COPIE = 0.15


def nomi_canali_extra(pagina):
    """Nomi dei canali extra salvati da Photoshop (risorsa 0x03EE), nell'ordine dei canali."""
    if 34377 not in pagina.tags:
        return []
    dati = pagina.tags[34377].value
    i = 0
    while i < len(dati) - 12 and dati[i:i + 4] == b'8BIM':
        rid = int.from_bytes(dati[i + 4:i + 6], 'big')
        nl = dati[i + 6]
        nl2 = nl + 1 + ((nl + 1) % 2)
        size = int.from_bytes(dati[i + 6 + nl2:i + 10 + nl2], 'big')
        corpo = dati[i + 10 + nl2:i + 10 + nl2 + size]
        if rid == 0x03EE:
            nomi, j = [], 0
            while j < len(corpo):
                n = corpo[j]
                nomi.append(corpo[j + 1:j + 1 + n].decode('latin-1'))
                j += 1 + n
            return nomi
        i += 10 + nl2 + size + (size % 2)
    return []


def leggi(percorso):
    """Ritorna (colore, è cmyk, alfa uint8 HxW, profilo icc dell'originale, note, dpi)."""
    with tifffile.TiffFile(percorso) as t:
        p = t.pages[0]
        a = p.asarray()
        icc = p.tags[34675].value if 34675 in p.tags else None
        nomi = nomi_canali_extra(p)
        cmyk = p.photometric.name == 'SEPARATED'
        res = p.tags[282].value if 282 in p.tags else (DPI, 1)
        dpi = res[0] / res[1] if res[1] else DPI
        if 296 in p.tags and p.tags[296].value == 3:   # centimetri
            dpi *= 2.54
    if a.dtype == np.uint16:
        a = (a >> 8).astype(np.uint8)
    nc = 4 if cmyk else 3
    colore, extra = a[..., :nc], a[..., nc:]
    nomi = (nomi + [''] * extra.shape[-1])[:extra.shape[-1]]
    note = []
    if 'Trasparenza' in nomi:
        # La trasparenza è la forma vera; lo spot è la stessa forma già ridotta
        alfa = extra[..., nomi.index('Trasparenza')]
    elif extra.shape[-1]:
        # Lo spot di Photoshop è salvato come inchiostro = nero (0)
        idx = next((k for k, n in enumerate(nomi) if n.upper().startswith('SPOT')), extra.shape[-1] - 1)
        alfa = 255 - extra[..., idx]
    else:
        # Nessuna forma salvata: il fondo bianco diventa trasparente
        note.append('senza spot: fondo bianco tolto')
        alfa = np.where(colore.min(-1) > 245, 0, 255).astype(np.uint8)
    return colore, cmyk, alfa, icc, note, round(dpi, 2)


def in_cmyk(colore, cmyk, icc, fogra):
    if cmyk:
        return colore
    src = ImageCms.ImageCmsProfile(io.BytesIO(icc)) if icc else ImageCms.createProfile('sRGB')
    t = ImageCms.buildTransform(src, fogra, 'RGB', 'CMYK', renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC,
                                flags=ImageCms.Flags.BLACKPOINTCOMPENSATION)
    return np.asarray(ImageCms.applyTransform(Image.fromarray(colore, 'RGB'), t))


def neri_k100(cmyk):
    """Neri ricchi e quasi neri -> 0/0/0/100. Ritorna l'immagine e la quota di pixel cambiati."""
    f = cmyk.astype(np.float32) / 255
    k = 1 - f[..., 3]
    rgb = np.stack([(1 - f[..., 0]) * k, (1 - f[..., 1]) * k, (1 - f[..., 2]) * k], -1)
    nero = (rgb.max(-1) < SOGLIA_NERO) & (rgb.max(-1) - rgb.min(-1) < SOGLIA_NEUTRO)
    out = cmyk.copy()
    out[nero] = (0, 0, 0, 255)
    return out, nero


def una_copia(alfa, dpi):
    """Se l'originale ha più copie affiancate (staccate o attaccate), ritorna (colonne della prima, copie).
    Sposta la forma di 1/4, 1/3 e 1/2 della larghezza: se combacia quasi del tutto, sono copie.
    Il confronto è sulla forma sfocata, così anche gli spot a retino delle versioni scure si riconoscono."""
    if alfa.shape[1] / dpi * 2.54 <= LARGHEZZA_COPIE_CM:
        return None, 1
    f = max(1, alfa.shape[1] // 400)
    h, w = alfa.shape[0] // f * f, alfa.shape[1] // f * f
    m = alfa[:h, :w].astype(np.float32).reshape(h // f, f, w // f, f).mean((1, 3)) / 255
    w = m.shape[1]
    for n in (4, 3, 2):
        migliore, spost = 9, None
        for sh in range(int(w / n * 0.9), int(w / n * 1.1) + 1):
            a, b = m[:, :w - sh], m[:, sh:]
            dove = np.maximum(a, b) > 0.05
            if dove.any():
                d = np.abs(a - b)[dove].mean()
                if d < migliore:
                    migliore, spost = d, sh
        if migliore <= DIFFERENZA_COPIE:
            # La prima copia finisce dove inizia la seconda; si parte dalla prima colonna con inchiostro
            x0 = int(np.argmax(m.max(0) > 0.05))
            return (x0 * f, (x0 + spost) * f), n
    return None, 1


def ritaglia(cmyk, alfa):
    m = alfa > 0
    r, c = np.where(m.any(1))[0], np.where(m.any(0))[0]
    return cmyk[r[0]:r[-1] + 1, c[0]:c[-1] + 1], alfa[r[0]:r[-1] + 1, c[0]:c[-1] + 1]


def scrivi_tif(percorso, cmyk, alfa, icc, dpi=DPI):
    dati = np.dstack([cmyk, alfa])
    tmp = percorso.with_suffix('.part')
    tifffile.imwrite(tmp, dati, photometric='separated', extrasamples=[2], compression='zlib',
                     resolution=(dpi, dpi), resolutionunit='INCH', iccprofile=icc, metadata=None)
    tmp.rename(percorso)


def lavora(sorgente, dest, fogra_bytes, fogra):
    colore, cmyk, alfa, icc, note, dpi = leggi(sorgente)
    colore = in_cmyk(colore, cmyk, icc, fogra)
    if not cmyk:
        note.append('convertito da RGB')
    colonne, copie = una_copia(alfa, dpi)
    if colonne:
        colore, alfa = colore[:, colonne[0]:colonne[1]], alfa[:, colonne[0]:colonne[1]]
        note.append(f'{copie} copie: tenuta la prima')
    colore, alfa = ritaglia(colore, alfa)
    colore, nero = neri_k100(colore)
    quota_nero = (nero & (alfa > 127)).sum() / max((alfa > 127).sum(), 1)
    scrivi_tif(dest, colore, alfa, fogra_bytes, dpi)
    h, w = alfa.shape
    if dpi < 250:
        note.append(f'risoluzione bassa: {dpi:g} dpi')
    return {'file': dest.name, 'dpi': dpi, 'larghezza_cm': round(w / dpi * 2.54, 1), 'altezza_cm': round(h / dpi * 2.54, 1),
            'nero_k100_%': round(float(quota_nero) * 100, 1), 'note': '; '.join(note)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('originali', type=Path)
    ap.add_argument('destinazione', type=Path)
    ap.add_argument('--profilo', type=Path, help='ICC CMYK; se manca si prende quello FOGRA39 dagli originali')
    ap.add_argument('--solo', nargs='*')
    args = ap.parse_args()
    args.destinazione.mkdir(parents=True, exist_ok=True)
    fogra_bytes = args.profilo.read_bytes() if args.profilo else None
    if not fogra_bytes:
        for f in sorted(args.originali.glob('*.tif')):
            with tifffile.TiffFile(f) as t:
                p = t.pages[0]
                if p.photometric.name == 'SEPARATED' and 34675 in p.tags:
                    fogra_bytes = p.tags[34675].value
                    break
    fogra = ImageCms.ImageCmsProfile(io.BytesIO(fogra_bytes))
    print('Profilo:', ImageCms.getProfileDescription(fogra).strip())
    righe = []
    for f in sorted(args.originali.glob('*.tif')):
        if args.solo and f.name not in args.solo:
            continue
        try:
            r = lavora(f, args.destinazione / f.name, fogra_bytes, fogra)
        except Exception as e:
            r = {'file': f.name, 'note': f'ERRORE {type(e).__name__}: {e}'}
        print(r, flush=True)
        righe.append(r)
    if not args.solo:
        with open(args.destinazione / 'libreria.csv', 'w', newline='') as fh:
            w = csv.DictWriter(fh, fieldnames=['file', 'dpi', 'larghezza_cm', 'altezza_cm', 'nero_k100_%', 'note'], delimiter=';')
            w.writeheader()
            w.writerows(righe)


if __name__ == '__main__':
    sys.exit(main())
