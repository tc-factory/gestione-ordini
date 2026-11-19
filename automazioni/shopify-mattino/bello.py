"""Calzini "Personalizzato Bello ... ma la figa?!" / "... ma il c***o?!" di Ciucciami.

Il modello Customily mette nel file di produzione solo lo sfondo: la scritta "BELLO ... MA LA FIGA?!" è
un'immagine della sola anteprima e il testo del cliente non è collegato a nessun livello. Qui la scritta si
compone sopra il file scaricato, con lo stesso stile dei calzini "Bello il <sport>" (GROBOLD bianco con bordo
nero di 2 mm, riquadro 8x11 cm in alto in ciascuna metà del foglio 23x43):

    BELLO / <testo del cliente> / MA LA / FIGA!?        (oppure MA IL / CA**O!?)

Le righe fisse hanno sempre la stessa misura; quelle del cliente vanno a capo tra le parole e, se serve,
si stringono in orizzontale. Se la scritta è troppo alta per il riquadro si rimpicciolisce tutta.

Uso a mano (prova o ristampa di un ordine):
    python bello.py <file di produzione.png> "<testo>" figa|cazzo <uscita.png>
"""
import io
import itertools
import math
import re
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

FONT = Path(__file__).parent / 'fonts' / 'GROBOLD.ttf'
DPI = 300
mm = lambda v: round(v / 25.4 * DPI)
W, H = mm(115), mm(215)          # metà del foglio 23x43 (fronte di un calzino)
BW, BH = mm(80), mm(110)         # riquadro della scritta 8 x 11 cm
BX, BY = (W - BW) // 2, (H - BH) // 2
S = mm(2)                        # bordo nero 2 mm
TR = round(S * 0.7)              # spaziatura extra tra le lettere
GAP = 0.06                       # spazio tra le righe, in frazione del corpo
MIN_STRETTA = 0.75               # sotto questo restringimento il testo va a capo tra le parole
CENSURA = 'ZZ'                   # CA**O!? resta largo quanto CAZZO!?

PRIMA = 'BELLO'
ARTICOLI = {'IL', 'LO', 'LA', 'I', 'GLI', 'LE', 'UN', 'UNO', 'UNA'}
FINALI = {'figa': ['MA LA', 'FIGA!?'], 'cazzo': ['MA IL', 'CA**O!?']}
# Il corpo è lo stesso dei calzini "Bello il <sport>": il più grande per cui queste righe stanno negli 8 cm
_RIGHE_CORPO = ['BELLO IL', 'BELLA LA', 'BELLE LE', 'BELLO LO', 'BELLA', 'BELLO', 'MA LA', 'FIGA!?', 'MA IL', 'CA**O!?']


def finale_da_titolo(titolo):
    """'figa' / 'cazzo' per i due prodotti "Personalizzato Bello ...", altrimenti None."""
    t = (titolo or '').lower()
    if 'personalizzato' not in t or 'bello' not in t:
        return None
    if 'figa' in t:
        return 'figa'
    if 'c***o' in t or 'cazzo' in t or 'ca**o' in t:
        return 'cazzo'
    return None


def testo_cliente(attributi):
    """Il campo "Testo (verranno sostituiti i puntini)" della riga d'ordine."""
    for a in attributi:
        k = a['key'] if isinstance(a, dict) and 'key' in a else a.get('name', '')
        if k.lower().startswith('testo'):
            return (a.get('value') or '').strip()
    return ''


# ---------- disegno (stesse regole di genera_scritte.py) ----------

def _glifo(f, c):
    if c == "'":   # l'apostrofo di GROBOLD è un trattino: si usa la virgola alzata
        return ',', f.getbbox('H')[1] - f.getbbox(',')[1]
    return c, 0


def _avanzo(f, c):
    if c == '*':   # GROBOLD non ha l'asterisco: largo come la media delle lettere censurate
        return sum(f.getlength(l) for l in CENSURA) / len(CENSURA)
    return f.getlength(_glifo(f, c)[0])


def _estensione(f, c):
    if c == '*':
        return 0, _avanzo(f, c)
    b = f.getbbox(_glifo(f, c)[0])
    return b[0], b[2]


def _asterisco(f, cx):
    top, bot = f.getbbox('H')[1], f.getbbox('H')[3]
    stelo = f.getbbox('I')[2] - f.getbbox('I')[0]
    sp = min(stelo * 0.42, (bot - top) * 0.3)
    r = ((bot - top) - sp) / 2
    cy = top + r + sp / 2
    q = 4
    n = round(2 * (r + sp))
    tmp = Image.new('L', (n * q, n * q), 0)
    td = ImageDraw.Draw(tmp)
    c0 = n * q / 2
    for k in range(3):
        a = math.pi / 2 + k * math.pi / 3
        dx, dy = math.cos(a) * r * q, math.sin(a) * r * q
        td.line([(c0 - dx, c0 - dy), (c0 + dx, c0 + dy)], fill=255, width=round(sp * q))
        for sx in (1, -1):
            e = (c0 + sx * dx, c0 + sx * dy)
            td.ellipse([e[0] - sp * q / 2, e[1] - sp * q / 2, e[0] + sp * q / 2, e[1] + sp * q / 2], fill=255)
    return tmp.resize((n, n), Image.LANCZOS), (round(cx - n / 2), round(cy - n / 2))


def _misura(f, t):
    xs, x = [], 0
    for i, c in enumerate(t):
        xs.append(x)
        x += _avanzo(f, c) + (TR if i < len(t) - 1 else 0)
    vis = [(xs[i], c) for i, c in enumerate(t) if c != ' ']
    return xs, min(x + _estensione(f, c)[0] for x, c in vis), max(x + _estensione(f, c)[1] for x, c in vis)


_font = None


def _carica():
    """Font e corpo si calcolano al primo uso, così importare il modulo non richiede il font."""
    global _font
    if _font is None:
        size = 40
        while True:
            f = ImageFont.truetype(str(FONT), size + 1)
            if max(r - l for _, l, r in (_misura(f, t) for t in _RIGHE_CORPO)) + 2 * S > BW:
                break
            size += 1
        _font = (ImageFont.truetype(str(FONT), size), size)
    return _font


def _ha_glifo(f, c):
    """GROBOLD ha poche lettere: quelle che mancano escono come un rettangolo vuoto (o niente)."""
    if c in " *'":
        return True
    vuoto = f.getmask('￿').getbbox()
    m = f.getmask(c)
    return m.getbbox() is not None and (vuoto is None or bytes(m) != bytes(f.getmask('￿')))


SOSTITUTI = {'À': 'A', 'Á': 'A', 'Â': 'A', 'Ä': 'A', 'È': 'E', 'É': 'E', 'Ê': 'E', 'Ë': 'E', 'Ì': 'I', 'Í': 'I',
             'Î': 'I', 'Ï': 'I', 'Ò': 'O', 'Ó': 'O', 'Ô': 'O', 'Ö': 'O', 'Ù': 'U', 'Ú': 'U', 'Û': 'U', 'Ü': 'U',
             'Ç': 'C', 'Ñ': 'N', '’': "'", '‘': "'", '`': "'", '´': "'", '“': '"', '”': '"', '…': '...'}


def pulisci_testo(testo, finale):
    """Maiuscolo, senza "bello" iniziale né "ma la figa" finale scritti dal cliente, senza caratteri che il font
    non ha (le vocali accentate diventano senza accento, se il font non le ha). Ritorna (testo, avvisi)."""
    f, _ = _carica()
    avvisi = []
    t = ' '.join((testo or '').split()).upper()
    t = re.sub(r'^(BELL[OAIE])\b[\s.,…]*', '', t)
    t = re.sub(r'[\s.,…]*\bMA\s+(LA\s+FIGA|IL\s+C\S*O)\b.*$', '', t)
    t = t.strip(' .…')
    out = []
    for c in t:
        if not _ha_glifo(f, c):
            s = SOSTITUTI.get(c)
            if s and all(_ha_glifo(f, x) for x in s):
                out.append(s)
                continue
            if c not in out and c.strip():
                avvisi.append(f'carattere "{c}" tolto (il font non lo ha)')
            continue
        out.append(c)
    t = ' '.join(''.join(out).split())
    return t, avvisi


def _maschera(t):
    f, _ = _carica()
    asc, desc = f.getmetrics()
    xs, l, r = _misura(f, t)
    m = Image.new('L', (int(r - l) + 2, asc + desc), 0)
    d = ImageDraw.Draw(m)
    for c, x in zip(t, xs):
        if c == '*':
            a, pos = _asterisco(f, x - l + _avanzo(f, c) / 2)
            m.paste(255, pos, a)
        elif c != ' ':
            g, dy = _glifo(f, c)
            d.text((x - l, dy), g, font=f, fill=255)
    return m


def _dilata(m, r):
    out = Image.new('L', (m.width + 2 * r, m.height + 2 * r), 0)
    out.paste(m, (r, r))
    for i in range(r):
        if i % 2 == 0:
            out = out.filter(ImageFilter.MaxFilter(3))
        else:
            croce = out
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                croce = ImageChops.lighter(croce, ImageChops.offset(out, dx, dy))
            out = croce
    return out


def _fattore(t):
    return min(1.0, (BW - 2 * S) / _maschera(t).width)


def _divisioni(parole):
    """Tutti i modi di andare a capo tra le parole (al massimo 8 parole, poi a capo "a riempimento")."""
    if len(parole) <= 8:
        for tagli in itertools.product([False, True], repeat=len(parole) - 1):
            righe, cur = [], [parole[0]]
            for p, t in zip(parole[1:], tagli):
                if t:
                    righe.append(' '.join(cur)); cur = [p]
                else:
                    cur.append(p)
            righe.append(' '.join(cur))
            yield righe
        return
    righe, cur = [], []
    for p in parole:
        prova = ' '.join(cur + [p])
        if cur and _fattore(prova) < MIN_STRETTA:
            righe.append(' '.join(cur)); cur = [p]
        else:
            cur.append(p)
    righe.append(' '.join(cur))
    yield righe


def _scegli(testo):
    """Meno righe possibile senza stringere troppo; altrimenti la divisione meno stretta."""
    valutate = sorted((len(d), -min(_fattore(t) for t in d), d) for d in _divisioni(testo.split()))
    for n, neg, d in valutate:
        if -neg >= MIN_STRETTA:
            return d
    return max(valutate, key=lambda v: (-v[1], -v[0]))[2]


def scritta(testo, finale):
    """PNG trasparente W x H (metà foglio) con la scritta allineata in alto nel riquadro 8x11 cm."""
    f, corpo = _carica()
    prima = PRIMA
    parole = testo.split()
    # Come nei calzini "Bello il <sport>": l'articolo sta sulla prima riga (BELLO IL / FANTACALCIO)
    if len(parole) > 1 and parole[0] in ARTICOLI:
        prima = f'{PRIMA} {parole[0]}'
        testo = ' '.join(parole[1:])
    centrali = _scegli(testo) if testo else []
    righe = [prima] + centrali + FINALI[finale]
    variabili = range(1, 1 + len(centrali))
    cap_top, cap_bot = f.getbbox('H')[1], f.getbbox('H')[3]
    passo = (cap_bot - cap_top) + 2 * S + round(corpo * GAP)
    alto = BY + len(righe) * passo + corpo
    img = Image.new('RGBA', (W, max(H, alto)), (0, 0, 0, 0))
    for i, t in enumerate(righe):
        m = _maschera(t)
        k = min(1.0, (BW - 2 * S) / m.width) if i in variabili else 1.0
        if k < 1:
            m = m.resize((max(1, round(m.width * k)), m.height), Image.LANCZOS)
        bordo = _dilata(m, S)
        riga = Image.new('RGBA', bordo.size, (0, 0, 0, 0))
        riga.paste((0, 0, 0, 255), (0, 0), bordo)
        riga.paste((255, 255, 255, 255), (S, S), m)
        img.alpha_composite(riga, (BX + (BW - riga.width) // 2, BY + i * passo - cap_top))
    b = img.getbbox()
    blocco = img.crop(b)
    if blocco.height > BH:   # testo lunghissimo: si rimpicciolisce tutto per stare negli 11 cm
        k = BH / blocco.height
        blocco = blocco.resize((round(blocco.width * k), BH), Image.LANCZOS)
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    out.alpha_composite(blocco, ((W - blocco.width) // 2, BY))
    return out, righe


def componi(png, testo, finale):
    """Aggiunge la scritta, in alto in tutte e due le metà, al file di produzione (bytes PNG).
    Ritorna (bytes PNG, righe scritte, avvisi)."""
    pulito, avvisi = pulisci_testo(testo, finale)
    if not pulito:
        avvisi.append('testo del cliente vuoto: stampato solo BELLO ... MA ' + ('LA FIGA' if finale == 'figa' else 'IL CA**O'))
    sc, righe = scritta(pulito, finale)
    with Image.open(io.BytesIO(png)) as im:
        dpi = im.info.get('dpi', (DPI, DPI))
        base = im.convert('RGBA')
    meta = (base.width // 2, base.height // 2)
    if sc.size != meta:
        sc = sc.resize(meta, Image.LANCZOS)
    for x in (0, base.width - meta[0]):
        base.alpha_composite(sc, (x, 0))
    buf = io.BytesIO()
    base.save(buf, 'PNG', dpi=dpi)
    return buf.getvalue(), righe, avvisi


if __name__ == '__main__':
    if len(sys.argv) != 5 or sys.argv[3] not in FINALI:
        sys.exit(__doc__)
    dati, righe, avvisi = componi(Path(sys.argv[1]).read_bytes(), sys.argv[2], sys.argv[3])
    Path(sys.argv[4]).write_bytes(dati)
    print(' / '.join(righe))
    for a in avvisi:
        print('ATTENZIONE:', a)
