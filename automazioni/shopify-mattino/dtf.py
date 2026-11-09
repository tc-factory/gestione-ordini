"""Fogli DTF di Box Factory Lab: grafiche delle t-shirt, nomi e bandiere degli ordini, in TIF CMYK + SPOT.

La libreria sta nella cartella condivisa, in "Box Factory Lab DTF":
- grafiche/       una grafica per file, CMYK FOGRA39 con trasparenza (fatta da automazioni/box-factory-dtf/libreria.py)
- bandiere/       PNG di Live Printing, con il nome italiano in bandiere.csv
- mappa-prodotti.csv   nome della grafica nel titolo del prodotto -> file per t-shirt chiare e scure

Regole (decise dall'utente):
- ogni grafica sta intera nel riquadro del capo, senza ingrandirla;
- nome in Impact 200 pt: oltre 28 cm si stringe in larghezza, oltre 40 cm va su 2 righe;
  bianco sulle t-shirt scure, nero 0/0/0/100 sulle chiare;
- bandiera 5x3,5 cm, da sola (va sulla manica);
- lo SPOT è la forma di tutto, ridotta di 1 px;
- fogli al massimo 57x100 cm, a righe (si tagliano dritti), margine 10 mm e distanza 8 mm come il profilo DTF
  di Live Printing; accanto a ogni pezzo il numero d'ordine.
"""
import csv
import io
import re
import unicodedata
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image, ImageCms, ImageDraw, ImageFilter, ImageFont

DPI = 300
MM = DPI / 25.4
FOGLIO_LARGO_MM, FOGLIO_ALTO_MM = 570, 1000
MARGINE_MM, DISTANZA_MM = 10, 8
ETICHETTA_MM = 4          # altezza del numero d'ordine, scritto in verticale a sinistra del pezzo
SPAZIO_ETICHETTA_MM = 2

FONT_NOME = '/System/Library/Fonts/Supplemental/Impact.ttf'
NOME_PT = 200
NOME_STRINGI_CM, NOME_DUE_RIGHE_CM = 28, 40
INTERLINEA = 0.18         # spazio tra le due righe, in proporzione all'altezza delle lettere
BANDIERA_CM = (5, 3.5)

# Riquadro della grafica per tipo di capo, in cm
RIQUADRI = {'uomo': 25, 'donna': 23, 'bambino_grande': 20, 'bambino_piccolo': 15, 'body': 10, 'bavaglino': 8}
COLORI_SCURI = {'nero', 'navy', 'blu', 'blu navy', 'antracite', 'grigio scuro', 'verde militare', 'bordeaux'}

CARTELLA_LIBRERIA = 'Box Factory Lab DTF'


def normalizza(testo):
    t = unicodedata.normalize('NFKD', testo or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', ' ', t).strip()


# ── Capi e personalizzazioni negli ordini ──

def tipo_capo(titolo, variante):
    """('uomo'|'donna'|..., grafica) dal titolo "T-shirt Uomo - Batman"; None se non è un capo DTF."""
    if ' - ' not in titolo:
        return None
    tipo, grafica = titolo.split(' - ', 1)
    t = normalizza(tipo)
    if t == 't shirt uomo':
        return 'uomo', grafica
    if t == 't shirt donna':
        return 'donna', grafica
    if t in ('tshirt bambini', 't shirt bambini', 'tshirt bambino', 't shirt bambino'):
        taglia = next((p for p in (variante or '').replace(' ', '').split('/') if p.isdigit()), None)
        return ('bambino_grande' if taglia in ('10', '12') else 'bambino_piccolo'), grafica
    if t == 'body':
        return 'body', grafica
    if t == 'bavaglino':
        return 'bavaglino', grafica
    return None


def capo_scuro(variante):
    return any(normalizza(p) in COLORI_SCURI for p in (variante or '').split('/'))


def personalizzazioni(attributi):
    """(nome, bandiera) dai campi visibili della riga. "Stampa nome: No" vuol dire niente nome."""
    a = {x['key'].strip(): (x['value'] or '').strip() for x in attributi if not x['key'].startswith('_')}
    nome = next((v for k, v in a.items() if normalizza(k).startswith('nome') and normalizza(k) not in ('nome alto', 'nome basso') and v), '')
    if normalizza(a.get('Stampa nome', 'si')) in ('no', 'off', 'false'):
        nome = ''
    bandiera = next((v for k, v in a.items() if normalizza(k).startswith('bandiera') and v), '')
    return nome, bandiera


# ── Libreria ──

class Libreria:
    def __init__(self, base):
        self.base = Path(base)
        self.mappa = {}
        self.verificare = {}
        with open(self.base / 'mappa-prodotti.csv', newline='', encoding='utf-8-sig') as f:
            for r in csv.DictReader(f, delimiter=';'):
                self.mappa[normalizza(r['grafica'])] = (r.get('file_tshirt_chiare') or '').strip(), (r.get('file_tshirt_scure') or '').strip()
                if (r.get('da_verificare') or '').strip():
                    self.verificare[normalizza(r['grafica'])] = r['da_verificare'].strip()
        self.bandiere = {}
        p = self.base / 'bandiere' / 'bandiere.csv'
        if p.exists():
            with open(p, newline='', encoding='utf-8') as f:
                for r in csv.DictReader(f, delimiter=';'):
                    self.bandiere[normalizza(r['nome'])] = r['codice']
                    self.bandiere[normalizza(r['codice'])] = r['codice']
        self.icc = None
        self._fogra = None

    def file_grafica(self, grafica, scuro):
        coppia = self.mappa.get(normalizza(grafica))
        if not coppia:
            return None
        nome = coppia[1] if scuro else coppia[0]
        return self.base / 'grafiche' / nome if nome else None

    def fogra(self):
        """Profilo CMYK delle grafiche: lo stesso finisce nei fogli."""
        if self._fogra is None:
            for f in sorted((self.base / 'grafiche').glob('*.tif')):
                with tifffile.TiffFile(f) as t:
                    if 34675 in t.pages[0].tags:
                        self.icc = t.pages[0].tags[34675].value
                        break
            self._fogra = ImageCms.ImageCmsProfile(io.BytesIO(self.icc))
        return self._fogra


# ── Elementi: (cmyk HxWx4 uint8, alfa HxW uint8) a 300 dpi ──

def ridimensiona(cmyk, alfa, w, h):
    w, h = max(1, round(w)), max(1, round(h))
    c = np.asarray(Image.fromarray(cmyk, 'CMYK').resize((w, h), Image.LANCZOS))
    a = np.asarray(Image.fromarray(alfa, 'L').resize((w, h), Image.LANCZOS))
    return c, a


def grafica(percorso, lato_cm):
    """Grafica intera nel riquadro lato x lato, mai ingrandita oltre la sua misura reale."""
    with tifffile.TiffFile(percorso) as t:
        p = t.pages[0]
        a = p.asarray()
        res = p.tags[282].value
        dpi = res[0] / res[1]
    cmyk, alfa = a[..., :4], a[..., 4]
    w_cm, h_cm = alfa.shape[1] / dpi * 2.54, alfa.shape[0] / dpi * 2.54
    s = min(1.0, lato_cm / w_cm, lato_cm / h_cm)
    return ridimensiona(cmyk, alfa, w_cm * s / 2.54 * DPI, h_cm * s / 2.54 * DPI)


def _riga(testo, font):
    """Maschera della riga di testo ritagliata sull'inchiostro."""
    x0, y0, x1, y1 = font.getbbox(testo)
    im = Image.new('L', (x1 - x0 + 4, y1 - y0 + 4), 0)
    ImageDraw.Draw(im).text((2 - x0, 2 - y0), testo, font=font, fill=255)
    a = np.asarray(im)
    r, c = np.where(a.any(1))[0], np.where(a.any(0))[0]
    return a[r[0]:r[-1] + 1, c[0]:c[-1] + 1]


def _stringi(maschera, max_px):
    if maschera.shape[1] <= max_px:
        return maschera
    return np.asarray(Image.fromarray(maschera).resize((int(max_px), maschera.shape[0]), Image.LANCZOS))


def dividi_in_due(testo):
    """Due righe: si spezza allo spazio più vicino a metà; senza spazi, a metà delle lettere."""
    spazi = [i for i, ch in enumerate(testo) if ch == ' ']
    if spazi:
        i = min(spazi, key=lambda k: abs(k - len(testo) / 2))
        return testo[:i].strip(), testo[i + 1:].strip()
    m = (len(testo) + 1) // 2
    return testo[:m], testo[m:]


def nome(testo, scuro, scala=1.0):
    """Nome in Impact 200 pt (scala < 1 per i capi piccoli). Bianco sulle scure, nero K100 sulle chiare."""
    font = ImageFont.truetype(FONT_NOME, round(NOME_PT / 72 * DPI * scala))
    stringi = NOME_STRINGI_CM * scala / 2.54 * DPI
    due = NOME_DUE_RIGHE_CM * scala / 2.54 * DPI
    testo = ' '.join(testo.split())
    m = _riga(testo, font)
    if m.shape[1] > due:
        righe = [_stringi(_riga(t, font), stringi) for t in dividi_in_due(testo) if t]
        alto = max(r.shape[0] for r in righe)
        spazio = round(alto * INTERLINEA)
        W = max(r.shape[1] for r in righe)
        H = sum(r.shape[0] for r in righe) + spazio * (len(righe) - 1)
        m = np.zeros((H, W), np.uint8)
        y = 0
        for r in righe:
            x = (W - r.shape[1]) // 2
            m[y:y + r.shape[0], x:x + r.shape[1]] = r
            y += r.shape[0] + spazio
    else:
        m = _stringi(m, stringi)
    cmyk = np.zeros(m.shape + (4,), np.uint8)
    if not scuro:
        cmyk[..., 3] = 255
    return cmyk, m


def neri_k100(cmyk, soglia=0.12, neutro=0.07):
    f = cmyk.astype(np.float32) / 255
    k = 1 - f[..., 3]
    rgb = np.stack([(1 - f[..., i]) * k for i in range(3)], -1)
    nero = (rgb.max(-1) < soglia) & (rgb.max(-1) - rgb.min(-1) < neutro)
    out = cmyk.copy()
    out[nero] = (0, 0, 0, 255)
    return out


def bandiera(percorso, fogra):
    im = Image.open(percorso).convert('RGBA')
    t = ImageCms.buildTransform(ImageCms.createProfile('sRGB'), fogra, 'RGB', 'CMYK',
                                renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC,
                                flags=ImageCms.Flags.BLACKPOINTCOMPENSATION)
    cmyk = neri_k100(np.asarray(ImageCms.applyTransform(im.convert('RGB'), t)))
    alfa = np.asarray(im)[..., 3]
    w, h = im.size
    s = min(BANDIERA_CM[0] / 2.54 * DPI / w, BANDIERA_CM[1] / 2.54 * DPI / h)
    return ridimensiona(cmyk, alfa, w * s, h * s)


# T-shirt personalizzata (Customily): loghi caricati dal cliente, nome alto e basso, bandiera.
# Riquadri dei loghi in cm sulla t-shirt uomo (sulla donna si riducono come la grafica, 23/25)
LOGHI_PERSONALIZZATA = {'logo 1': (25, 15), 'logo 2': (25, 15), 'logo 3': (25, 25)}


def campi_personalizzata(attributi):
    """{'logo 1': url, ..., 'nome alto': testo, 'nome basso': testo} dai campi della riga (anche nascosti con "_")."""
    out, filtrati = {}, {}
    for x in attributi:
        k = normalizza(x['key'].lstrip('_'))
        v = (x['value'] or '').strip()
        if not v:
            continue
        base = k.split(' image filter applied')[0]
        if base in LOGHI_PERSONALIZZATA and v.startswith('http'):
            # Customily salva l'originale in "_Logo 1" e, se c'è un filtro (es. fondo tolto), il PNG in "_Logo 1_image_filter_applied_1"
            (filtrati if base != k else out)[base] = v
        elif k in ('nome alto', 'nome basso'):
            out[k] = v
    out.update(filtrati)
    return out


def logo_caricato(url, larghezza_cm, altezza_cm, fogra):
    """Logo del cliente: in CMYK con i neri K100, intero nel riquadro. Ritorna (cmyk, alfa, nota)."""
    import requests
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    im = Image.open(io.BytesIO(r.content))
    nota = None
    if im.mode in ('RGBA', 'LA', 'PA') or (im.mode == 'P' and 'transparency' in im.info):
        im = im.convert('RGBA')
        alfa = np.asarray(im)[..., 3]
    else:
        im = im.convert('RGB')
        # Senza trasparenza: il fondo bianco diventa trasparente, da controllare a occhio
        alfa = np.where(np.asarray(im).min(-1) > 245, 0, 255).astype(np.uint8)
        nota = 'logo senza trasparenza, fondo bianco tolto: controllare'
    t = ImageCms.buildTransform(ImageCms.createProfile('sRGB'), fogra, 'RGB', 'CMYK',
                                renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC,
                                flags=ImageCms.Flags.BLACKPOINTCOMPENSATION)
    cmyk = neri_k100(np.asarray(ImageCms.applyTransform(im.convert('RGB'), t)))
    righe, colonne = np.where(alfa.any(1))[0], np.where(alfa.any(0))[0]
    if not len(righe):
        raise ValueError('logo vuoto')
    cmyk = cmyk[righe[0]:righe[-1] + 1, colonne[0]:colonne[-1] + 1]
    alfa = alfa[righe[0]:righe[-1] + 1, colonne[0]:colonne[-1] + 1]
    h, w = alfa.shape
    # Riempie il riquadro in larghezza o in altezza: il cliente l'ha visto così nell'anteprima
    s = min(larghezza_cm / 2.54 * DPI / w, altezza_cm / 2.54 * DPI / h)
    if DPI / s < 150:   # risoluzione effettiva sulla maglietta
        nota = (nota + '; ' if nota else '') + f'logo a bassa risoluzione ({DPI / s:.0f} dpi)'
    c, a = ridimensiona(cmyk, alfa, w * s, h * s)
    return c, a, nota


def etichetta(testo):
    """Numero d'ordine in nero K100, girato in verticale."""
    font_path = Path(__file__).parent / 'fonts' / 'NotoSans-Bold.ttf'
    font = ImageFont.truetype(str(font_path), round(ETICHETTA_MM * MM))
    m = _riga(testo, font)
    m = np.ascontiguousarray(np.rot90(m))
    cmyk = np.zeros(m.shape + (4,), np.uint8)
    cmyk[..., 3] = 255
    return cmyk, m


# ── Fogli ──

def disponi(pezzi):
    """Righe dritte, così il foglio si taglia prima in strisce e poi pezzo per pezzo (FFDH):
    i pezzi dal più alto al più basso, ognuno nella prima riga dove ci sta, altrimenti in una riga nuova.
    pezzi: [(w_px, h_px)] -> [(foglio, x, y)] nello stesso ordine, e altezze dei fogli in px."""
    W = FOGLIO_LARGO_MM * MM
    Hmax = FOGLIO_ALTO_MM * MM
    marg, gap = MARGINE_MM * MM, DISTANZA_MM * MM
    righe = []      # [foglio, y, altezza, x libero]
    fondo = []      # per foglio: y dove può iniziare la prossima riga
    pos = [None] * len(pezzi)
    for i in sorted(range(len(pezzi)), key=lambda k: (-pezzi[k][1], -pezzi[k][0])):
        w, h = pezzi[i]
        if w > W - 2 * marg or h > Hmax - 2 * marg:
            raise ValueError(f'pezzo troppo grande: {w / MM:.0f}x{h / MM:.0f} mm')
        riga = next((r for r in righe if h <= r[2] and r[3] + w <= W - marg), None)
        if riga is None:
            f = next((k for k, y in enumerate(fondo) if y + h <= Hmax - marg), None)
            if f is None:
                fondo.append(marg)
                f = len(fondo) - 1
            riga = [f, fondo[f], h, marg]
            fondo[f] += h + gap
            righe.append(riga)
        pos[i] = (riga[0], round(riga[3]), round(riga[1]))
        riga[3] += w + gap
    altezze = [round(y - gap + marg) for y in fondo]
    return pos, altezze


def _risorse_photoshop():
    """Canale extra "SPOT" come lo salva Photoshop: tinta piatta rossa, opacità 100%."""
    def blocco(rid, dati):
        # firma, id, nome vuoto (pascal, pari), lunghezza dei dati, dati portati a lunghezza pari
        return b'8BIM' + rid.to_bytes(2, 'big') + b'\x00\x00' + len(dati).to_bytes(4, 'big') + dati + b'\x00' * (len(dati) % 2)
    nomi = blocco(0x03EE, b'\x04SPOT')
    unicode_ = blocco(0x0415, (5).to_bytes(4, 'big') + 'SPOT\x00'.encode('utf-16-be'))
    display = blocco(0x0435, b'\x00\x00\x00\x01' + b'\x00\x00' + b'\xff\xff\x00\x00\x00\x00\x00\x00' + b'\x00\x64' + b'\x02')
    return nomi + unicode_ + display


def scrivi_foglio(percorso, cmyk, alfa, icc):
    """TIF CMYK + SPOT: lo spot è la forma di tutto ridotta di 1 px, salvato come Photoshop (inchiostro = 0)."""
    spot = np.asarray(Image.fromarray(alfa, 'L').filter(ImageFilter.MinFilter(3)))
    dati = np.dstack([cmyk, 255 - spot])
    tmp = percorso.with_suffix('.part')
    tifffile.imwrite(tmp, dati, photometric='separated', extrasamples=[0], compression='zlib',
                     resolution=(DPI, DPI), resolutionunit='INCH', iccprofile=icc, metadata=None,
                     extratags=[(34377, 7, None, _risorse_photoshop(), True)])
    tmp.rename(percorso)


def anteprima(percorso, cmyk, alfa):
    """JPG leggero per controllare il foglio senza Photoshop: fondo grigio, il bianco si vede."""
    s = 8
    c = cmyk[::s, ::s].astype(np.float32) / 255
    a = alfa[::s, ::s].astype(np.float32)[..., None] / 255
    k = 1 - c[..., 3:4]
    rgb = (1 - c[..., :3]) * k * 255
    img = rgb * a + np.array([150, 150, 150], np.float32) * (1 - a)
    Image.fromarray(img.astype(np.uint8)).save(percorso, quality=80)


def crea_fogli(cartella, nome_base, voci, libreria):
    """voci: [(ordine, titolo, variante, attributi, quantità)] nell'ordine di stampa.
    Ritorna (file creati, cose da fare a mano, ordini con problemi bloccanti)."""
    a_mano, falliti = [], set()
    elementi = []   # (ordine, cmyk, alfa)
    cache = {}
    for ordine, titolo, variante, attributi, quanti in voci:
        capo = tipo_capo(titolo, variante)
        if not capo:
            continue
        tipo, nome_grafica = capo
        scuro = capo_scuro(variante)
        testo, paese = personalizzazioni(attributi)
        pezzo = []
        if normalizza(nome_grafica) == 'personalizzata':
            campi = campi_personalizzata(attributi)
            scala_capo = min(1.0, RIQUADRI[tipo] / RIQUADRI['uomo'])
            for chiave, (w, h) in LOGHI_PERSONALIZZATA.items():
                if chiave in campi:
                    try:
                        c, a, nota = logo_caricato(campi[chiave], w * scala_capo, h * scala_capo, libreria.fogra())
                        pezzo.append((c, a))
                        if nota:
                            a_mano.append(f'{ordine}, {titolo}, {chiave.title()}: {nota}')
                    except Exception as e:
                        falliti.add(ordine)
                        a_mano.append(f'{ordine}, {titolo}, {chiave.title()}: file non scaricato ({type(e).__name__}: {str(e)[:60]})')
            for chiave in ('nome alto', 'nome basso'):
                if chiave in campi:
                    pezzo.append(nome(campi[chiave], scuro, min(1.0, RIQUADRI[tipo] / RIQUADRI['donna'])))
            if not campi and not paese:
                a_mano.append(f'{ordine}, {titolo}: nessun logo o nome nell\'ordine, controllare')
            percorso = False
        else:
            percorso = libreria.file_grafica(nome_grafica, scuro)
        if percorso is False:
            pass
        elif percorso is None:
            a_mano.append(f'{ordine}, {titolo}: nessun file in mappa-prodotti.csv, da fare a mano')
        elif not percorso.exists():
            a_mano.append(f'{ordine}, {titolo}: manca il file {percorso.name}, da fare a mano')
        else:
            chiave = (percorso, RIQUADRI[tipo])
            try:
                if chiave not in cache:
                    cache[chiave] = grafica(percorso, RIQUADRI[tipo])
                pezzo.append(cache[chiave])
                nota = libreria.verificare.get(normalizza(nome_grafica))
                if nota:
                    a_mano.append(f'{ordine}, {titolo}: controllare la grafica {percorso.name} ({nota})')
            except Exception as e:
                falliti.add(ordine)
                a_mano.append(f'{ordine}, {titolo}: grafica non letta ({type(e).__name__}: {str(e)[:60]})')
        if testo:
            # Nei capi piccoli il nome si riduce in proporzione al riquadro
            pezzo.append(nome(testo, scuro, min(1.0, RIQUADRI[tipo] / RIQUADRI['donna'])))
        if paese:
            codice = libreria.bandiere.get(normalizza(paese))
            if codice and (libreria.base / 'bandiere' / f'{codice}.png').exists():
                pezzo.append(bandiera(libreria.base / 'bandiere' / f'{codice}.png', libreria.fogra()))
            else:
                a_mano.append(f'{ordine}, {titolo}: bandiera "{paese}" non trovata, da fare a mano')
        for _ in range(quanti):
            elementi += [(ordine, c, a) for c, a in pezzo]
    if not elementi:
        return [], a_mano, falliti

    libreria.fogra()
    # Ogni pezzo ha a sinistra il suo numero d'ordine
    etichette = {o: etichetta(o) for o in {e[0] for e in elementi}}
    misure = []
    for ordine, c, a in elementi:
        e = etichette[ordine][1]
        misure.append((e.shape[1] + SPAZIO_ETICHETTA_MM * MM + a.shape[1], max(a.shape[0], e.shape[0])))
    pos, altezze = disponi(misure)
    W = round(FOGLIO_LARGO_MM * MM)
    creati = []
    numeri = sorted({int(re.sub(r'\D', '', o) or 0) for o, _, _ in elementi})
    intervallo = f'{numeri[0]}-{numeri[-1]}' if len(numeri) > 1 else f'{numeri[0]}'
    for f, H in enumerate(altezze):
        cmyk = np.zeros((H, W, 4), np.uint8)
        alfa = np.zeros((H, W), np.uint8)
        for (ordine, c, a), (fi, x, y) in zip(elementi, pos):
            if fi != f:
                continue
            ec, ea = etichette[ordine]
            _incolla(cmyk, alfa, ec, ea, x, y)
            _incolla(cmyk, alfa, c, a, x + ea.shape[1] + round(SPAZIO_ETICHETTA_MM * MM), y)
        suffisso = f' - foglio {f + 1} di {len(altezze)}' if len(altezze) > 1 else ''
        p = cartella / f'{nome_base} - {intervallo}{suffisso}.tif'
        scrivi_foglio(p, cmyk, alfa, libreria.icc)
        anteprima(p.with_name(p.stem + ' - anteprima.jpg'), cmyk, alfa)
        creati.append((p, round(H / MM / 10, 1)))
    return creati, a_mano, falliti


def _incolla(cmyk, alfa, c, a, x, y):
    h, w = a.shape
    reg_c = cmyk[y:y + h, x:x + w].astype(np.float32)
    k = a.astype(np.float32)[..., None] / 255
    cmyk[y:y + h, x:x + w] = (c.astype(np.float32) * k + reg_c * (1 - k)).round().astype(np.uint8)
    alfa[y:y + h, x:x + w] = np.maximum(alfa[y:y + h, x:x + w], a)
