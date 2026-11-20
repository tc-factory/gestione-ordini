"""T&C Factory — PDF → TIF per il DTF, come i fogli di Box Factory Lab (shopify-mattino/dtf.py):
  • CMYK Coated FOGRA39 a 300 dpi, misura della pagina del PDF;
  • neri ricchi e quasi neri portati a 0/0/0/100;
  • canale extra SPOT salvato come Photoshop (tinta piatta, inchiostro = 0): la forma di tutto quello
    che è stampato (il fondo trasparente resta senza bianco), ridotta di RIDUZIONE pixel (0, 1, 2 o 3).
Una pagina → <nome>.tif; più pagine → <nome> - pag 1.tif, <nome> - pag 2.tif…
I file si scrivono prima come .part e poi si rinominano: nella cartella non resta mai un TIF a metà.

Gira nel suo ambiente (venv con pymupdf, numpy, pillow, tifffile), chiamato da dtf_cartella.py.
Uso:  dtf_tiff.py PDF RIDUZIONE --icc fogra39.icc
Stampa in JSON i nomi dei TIF scritti.
"""
import argparse
import json
import os
import sys

import numpy as np
import pymupdf
import tifffile
from PIL import Image, ImageFilter

DPI = 300
SOGLIA_NERO = 0.12      # come box-factory-dtf/libreria.py
SOGLIA_NEUTRO = 0.07


def neri_k100(cmyk):
    f = cmyk.astype(np.float32) / 255
    k = 1 - f[..., 3]
    rgb = np.stack([(1 - f[..., 0]) * k, (1 - f[..., 1]) * k, (1 - f[..., 2]) * k], -1)
    nero = (rgb.max(-1) < SOGLIA_NERO) & (rgb.max(-1) - rgb.min(-1) < SOGLIA_NEUTRO)
    out = cmyk.copy()
    out[nero] = (0, 0, 0, 255)
    return out


def risorse_photoshop():
    """Canale extra "SPOT" come lo salva Photoshop: tinta piatta rossa, opacità 100% (come dtf.py)."""
    def blocco(rid, dati):
        return b'8BIM' + rid.to_bytes(2, 'big') + b'\x00\x00' + len(dati).to_bytes(4, 'big') + dati + b'\x00' * (len(dati) % 2)
    nomi = blocco(0x03EE, b'\x04SPOT')
    unicode_ = blocco(0x0415, (5).to_bytes(4, 'big') + 'SPOT\x00'.encode('utf-16-be'))
    display = blocco(0x0435, b'\x00\x00\x00\x01' + b'\x00\x00' + b'\xff\xff\x00\x00\x00\x00\x00\x00' + b'\x00\x64' + b'\x02')
    return nomi + unicode_ + display


def pagina_in_tif(pagina, dest, riduzione, icc):
    # MuPDF converte in CMYK col suo profilo di default (Coated FOGRA39); i colori sono già
    # composti sul bianco (premoltiplicati), come un TIF unito in Photoshop
    pix = pagina.get_pixmap(dpi=DPI, colorspace=pymupdf.csCMYK, alpha=True)
    a = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)
    cmyk, alfa = neri_k100(np.ascontiguousarray(a[..., :4])), a[..., 4]
    if alfa.max() == 0:
        raise ValueError('pagina vuota')
    spot = alfa if riduzione <= 0 else np.asarray(Image.fromarray(alfa, 'L').filter(ImageFilter.MinFilter(2 * riduzione + 1)))
    dati = np.dstack([cmyk, 255 - spot])
    tmp = dest + '.part'
    tifffile.imwrite(tmp, dati, photometric='separated', extrasamples=[0], compression='zlib',
                     resolution=(DPI, DPI), resolutionunit='INCH', iccprofile=icc, metadata=None,
                     extratags=[(34377, 7, None, risorse_photoshop(), True)])
    os.replace(tmp, dest)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('riduzione', type=int, choices=[0, 1, 2, 3])
    ap.add_argument('--icc', required=True, help='profilo Coated FOGRA39 da incorporare')
    a = ap.parse_args()
    icc = open(a.icc, 'rb').read()
    cartella, nome = os.path.split(a.pdf)
    radice = os.path.splitext(nome)[0].rstrip()
    doc = pymupdf.open(a.pdf)
    if doc.needs_pass:
        raise SystemExit('PDF protetto da password')
    if not doc.page_count:
        raise SystemExit('PDF senza pagine')
    scritti = []
    for i, pagina in enumerate(doc):
        n = f'{radice}.tif' if doc.page_count == 1 else f'{radice} - pag {i + 1}.tif'
        pagina_in_tif(pagina, os.path.join(cartella, n), a.riduzione, icc)
        scritti.append(n)
    print(json.dumps(scritti, ensure_ascii=False))


if __name__ == '__main__':
    sys.exit(main())
