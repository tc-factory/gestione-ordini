#!/usr/bin/env python3
"""Automazione del mattino: cartella del giorno, PDF dei DDT, file di stampa di Ciucciami e Box Factory Lab, tag "stampato".

Senza --applica è una prova: crea i PDF ma non scrive nulla su Shopify.
Il tag si mette solo dopo aver riaperto e controllato i PDF salvati.

Uso:  python mattino.py --cartella "/Users/Shared/Creative System" [--applica] [--env percorso/.env]
Esce con codice 1 se qualcosa non è andato: il riepilogo in cima al PDF dei DDT dice cosa.
"""
import argparse
import datetime as dt
import io
import os
import re
import shutil
import sys
import tempfile
import time
import traceback
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from PIL import Image
from pypdf import PdfReader
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

API = '2026-10'
ROMA = ZoneInfo('Europe/Rome')
QUI = Path(__file__).parent
MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']

# Il tag dell'automazione è diverso da quello manuale, così si distinguono. Nessuno dei due va ristampato
TAG_AUTOMAZIONE = 'auto-stampato'
TAG_GIA_STAMPATI = {'stampato', TAG_AUTOMAZIONE}
# Negozi con il PDF dei file di stampa (uno per negozio) e l'inizio del nome del file.
# Tutti e due usano Customily con file 23x43. Gli altri arriveranno dopo averli studiati
NEGOZI_FILE_STAMPA = {'ciucciamilcalzino': 'Ciucciami', 'boxfactorylab': 'Box-Factory-Lab'}
ATTR_FILE_STAMPA = '_customily-production-url'
PAGINA_STAMPA = (23 * cm, 43 * cm)
MAIL_VECCHIA_DOPO_MINUTI = 30
# Finora gli ordini in sospeso non si sono mai stampati: si stampano solo quelli pagati
PAGAMENTI_DA_STAMPARE = {'PAID', 'PARTIALLY_REFUNDED'}
# Customily genera il file qualche tempo dopo l'ordine: entro queste ore un file mancante non è un problema
ORE_ATTESA_FILE = 6
# Campi di servizio da non stampare sul DDT: tutti gli altri restano visibili, così non si perde nulla.
# Il nome da stampare, la sua posizione e i loghi non sono in questi elenchi.
CAMPI_NASCOSTI = {'stampa nome', 'stampe', 'cosa vuoi personalizzare?', 'quante bandiere vuoi stampare?'}
INIZIO_CAMPI_NASCOSTI = ('stampa nome (', 'scegli il font', 'image-swatches')

ORDINI_DA_STAMPARE = 'query($after:String){orders(first:100,after:$after,sortKey:CREATED_AT,query:"fulfillment_status:unfulfilled -status:cancelled -tag:stampato -tag:auto-stampato"){pageInfo{hasNextPage endCursor}nodes{id}}}'
ORDINE = '''query($id:ID!){order(id:$id){
  id name createdAt cancelledAt tags displayFulfillmentStatus displayFinancialStatus
  shippingAddress{name company address1 address2 zip city provinceCode country countryCodeV2}
  billingAddress{name company address1 address2 zip city provinceCode country countryCodeV2}
  lineItems(first:100){nodes{title variantTitle quantity unfulfilledQuantity requiresShipping
    image{url(transform:{maxWidth:160})} customAttributes{key value}}}
}}'''
NEGOZIO = '{shop{name contactEmail primaryDomain{host} billingAddress{address1 address2 zip city provinceCode country countryCodeV2}} currentAppInstallation{accessScopes{handle}}}'
AGGIUNGI_TAG = 'mutation($id:ID!,$tags:[String!]!){tagsAdd(id:$id,tags:$tags){userErrors{message}}}'


def leggi_data(testo):
    """Data ISO di Shopify o Supabase. Python 3.9 non accetta la Z né decimali di lunghezza variabile."""
    testo = testo.replace('Z', '+00:00')
    m = re.match(r'(.*?)(\.\d+)?([+-]\d\d:\d\d)$', testo)
    decimali = (m.group(2) or '.0')[1:].ljust(6, '0')[:6]
    return dt.datetime.fromisoformat(f'{m.group(1)}.{decimali}{m.group(3)}')


def carica_env(percorso):
    if percorso.exists():
        for riga in percorso.read_text().splitlines():
            if '=' in riga and not riga.lstrip().startswith('#'):
                k, v = riga.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip())
    mancanti = [k for k in ('CS_SUPABASE_URL', 'CS_ANON_KEY', 'CS_AUTOMAZIONE_KEY') if not os.environ.get(k)]
    if mancanti:
        sys.exit(f'Mancano le impostazioni: {", ".join(mancanti)}')


def chiama_gestionale(funzione, **parametri):
    r = requests.post(f"{os.environ['CS_SUPABASE_URL']}/rest/v1/rpc/{funzione}",
                      headers={'apikey': os.environ['CS_ANON_KEY'], 'Content-Type': 'application/json'},
                      json={'p_chiave': os.environ['CS_AUTOMAZIONE_KEY'], **parametri}, timeout=120)
    r.raise_for_status()
    d = r.json()
    if not d.get('success'):
        raise RuntimeError(d.get('error') or 'Gestionale non raggiungibile')
    return d


class Registro:
    """Scrive l'output sia nel file di registro sia nella scheda Automazioni del Centro di controllo.
    Se il gestionale non risponde il lavoro continua: il registro è un di più, l'allarme lo dà il controllo delle 5:30."""

    def __init__(self, nome):
        self.righe, self.id = [], None
        try:
            self.id = chiama_gestionale('tc_automazione_inizio', p_nome=nome)['id']
        except Exception as e:
            print(f'Registro non disponibile: {e}', file=sys.stderr)

    def scrivi(self, testo):
        print(testo, flush=True)
        self.righe.append(testo)

    def chiudi(self, stato, riepilogo=None):
        if self.id is None:
            return
        try:
            chiama_gestionale('tc_automazione_fine', p_id=self.id, p_stato=stato, p_riepilogo=riepilogo, p_output='\n'.join(self.righe))
        except Exception as e:
            print(f'Registro non aggiornato: {e}', file=sys.stderr)


def dati_gestionale():
    return chiama_gestionale('tc_mattino_dati')


def invia_esito(ok, negozi, messaggio=None):
    return chiama_gestionale('tc_mattino_esito', p_ok=ok, p_negozi=negozi, p_messaggio=messaggio)


class Shopify:
    def __init__(self, negozio):
        if not negozio.get('token'):
            raise RuntimeError('token mancante')
        self.url = f"https://{negozio['dominio']}/admin/api/{API}/graphql.json"
        self.headers = {'Content-Type': 'application/json', 'X-Shopify-Access-Token': negozio['token']}

    def chiama(self, query, **variabili):
        for tentativo in range(6):
            r = requests.post(self.url, headers=self.headers, json={'query': query, 'variables': variabili}, timeout=60)
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(2 ** tentativo)
                continue
            r.raise_for_status()
            d = r.json()
            if any((e.get('extensions') or {}).get('code') == 'THROTTLED' for e in d.get('errors', [])):
                time.sleep(2 ** tentativo)
                continue
            if d.get('errors'):
                raise RuntimeError(d['errors'][0].get('message', 'errore Shopify'))
            return d['data']
        raise RuntimeError('Shopify non risponde')

    def ordini_da_stampare(self):
        ordini, dopo = [], None
        while True:
            pagina = self.chiama(ORDINI_DA_STAMPARE, after=dopo)['orders']
            for n in pagina['nodes']:
                o = self.chiama(ORDINE, id=n['id'])['order']
                # Il filtro di Shopify non basta: si ricontrolla ordine per ordine prima di stampare
                if (o and not o['cancelledAt'] and o['displayFulfillmentStatus'] == 'UNFULFILLED'
                        and not TAG_GIA_STAMPATI & {t.lower() for t in o['tags']}):
                    ordini.append(o)
            if not pagina['pageInfo']['hasNextPage']:
                return ordini
            dopo = pagina['pageInfo']['endCursor']


# ── Disegno ──

def registra_font():
    pdfmetrics.registerFont(TTFont('Noto', QUI / 'fonts' / 'NotoSans-Regular.ttf'))
    pdfmetrics.registerFont(TTFont('NotoB', QUI / 'fonts' / 'NotoSans-Bold.ttf'))


def data_lunga(d):
    return f'{d.day} {MESI[d.month - 1]} {d.year}'


def indirizzo(a):
    if not a:
        return []
    citta = ' '.join(x for x in (a.get('zip'), a.get('city'), a.get('provinceCode')) if x)
    paese = 'Italia' if a.get('countryCodeV2') == 'IT' else a.get('country')
    return [x for x in (a.get('name'), a.get('company'), a.get('address1'), a.get('address2'), citta, paese) if x]


def miniatura(url, cache):
    if not url:
        return None
    if url not in cache:
        try:
            r = requests.get(url, timeout=30)
            r.raise_for_status()
            im = Image.open(io.BytesIO(r.content)).convert('RGBA')
            fondo = Image.new('RGB', im.size, 'white')
            fondo.paste(im, mask=im.getchannel('A'))
            b = io.BytesIO()
            fondo.save(b, 'JPEG', quality=85)
            b.seek(0)
            cache[url] = ImageReader(b)
        except Exception:
            cache[url] = None   # La miniatura è un di più: senza si stampa lo stesso
    return cache[url]


def e_aggiunta(l):
    """Riga di servizio del prodotto principale, come "Stampa Nome": il documento di Shopify non la mostra."""
    return l['title'] == 'Stampa Nome' or any(a['key'].startswith('_gpo_parent') for a in l['customAttributes'])


def righe_ddt(o):
    return [l for l in o['lineItems']['nodes'] if l['requiresShipping'] and l['unfulfilledQuantity'] > 0 and not e_aggiunta(l)]


def attributi_visibili(l):
    def visibile(a):
        k = a['key'].strip().lower()
        return not k.startswith('_') and k not in CAMPI_NASCOSTI and not k.startswith(INIZIO_CAMPI_NASCOSTI)
    return [a for a in l['customAttributes'] if visibile(a)]


def e_link(valore):
    return (valore or '').startswith(('http://', 'https://'))


def scarica_logo(url, cache):
    """Il logo caricato dal cliente: None se non è un'immagine leggibile."""
    if url not in cache:
        try:
            r = requests.get(url, timeout=30)
            r.raise_for_status()
            im = Image.open(io.BytesIO(r.content)).convert('RGBA')
            im.thumbnail((400, 400))
            fondo = Image.new('RGB', im.size, 'white')
            fondo.paste(im, mask=im.getchannel('A'))
            b = io.BytesIO()
            fondo.save(b, 'JPEG', quality=85)
            b.seek(0)
            cache[url] = ImageReader(b)
        except Exception:
            cache[url] = None
    return cache[url]


CORPO = 9.25


def disegna_ddt(c, o, shop, richieste, cache):
    """Stessa impaginazione del documento di trasporto di Shopify."""
    W, H = A4
    SX, DX = 84, 519
    CENTRO = 302

    def fascia():
        if not richieste:
            return
        testo = 'DA MODIFICARE: ' + ' / '.join(richieste)
        righe = simpleSplit(testo, 'NotoB', 8.5, DX - SX - 16)[:3]
        alto = 10 + 11 * len(righe)
        c.setFillColorRGB(0.8, 0.1, 0.1)
        c.rect(SX, H - 16 - alto, DX - SX, alto, stroke=0, fill=1)
        c.setFillColorRGB(1, 1, 1)
        c.setFont('NotoB', 8.5)
        for i, r in enumerate(righe):
            c.drawString(SX + 8, H - 16 - 14 - i * 11, r)
        c.setFillColorRGB(0, 0, 0)

    def testata():
        fascia()
        c.setFont('Noto', 17.5)
        c.drawString(SX, H - 81, shop['name'].upper())
        c.setFont('Noto', CORPO)
        c.drawRightString(DX, H - 73, f"Ordine {o['name']}")
        creato = leggi_data(o['createdAt']).astimezone(ROMA)
        c.drawRightString(DX, H - 86, data_lunga(creato))

    def intestazione_articoli(y):
        c.setFont('NotoB', 7.5)
        c.drawString(91, y, 'ARTICOLI')
        c.drawRightString(513, y, 'QUANTITÀ')

    testata()
    c.setFont('NotoB', 7.5)
    c.drawString(SX, H - 114, 'SPEDISCI A')
    c.drawString(268, H - 114, 'DESTINATARIO FATTURA')
    c.setFont('Noto', CORPO)
    def a_capo(righe, larghezza):
        return [x for r in righe for x in simpleSplit(r, 'Noto', CORPO, larghezza)]
    sped = a_capo(indirizzo(o.get('shippingAddress')), 174)
    fatt = a_capo(indirizzo(o.get('billingAddress')), 245)
    for i, r in enumerate(sped):
        c.drawString(SX, H - 134 - i * 14, r)
    for i, r in enumerate(fatt):
        c.drawString(268, H - 134 - i * 14, r)
    y = H - 134 - max(len(sped), len(fatt), 1) * 14 + 2
    y -= 6
    c.setLineWidth(1.2)
    c.line(SX, y, DX, y)
    y -= 22
    intestazione_articoli(y)
    y -= 12

    for l in righe_ddt(o):
        testi = simpleSplit(l['title'], 'Noto', CORPO, 300)
        if l['variantTitle']:
            testi += simpleSplit(l['variantTitle'], 'Noto', CORPO, 300)
        loghi = []
        for a in attributi_visibili(l):
            if e_link(a['value']):
                logo = scarica_logo(a['value'], cache) if len(loghi) < 2 else None
                if logo:
                    loghi.append((a['key'], logo))
                else:
                    testi.append(f"{a['key']}: da vedere sull'ordine")
            else:
                testi += simpleSplit(f"{a['key']}: {a['value']}", 'Noto', CORPO, 300)
        alto = max(len(testi) * 14, 36, 64 if loghi else 0)
        if y - alto < 60:
            c.showPage()
            testata()
            y = H - 120
            intestazione_articoli(y)
            y -= 12
        img = miniatura((l.get('image') or {}).get('url'), cache)
        if img:
            c.drawImage(img, 91, y - 18 - alto / 2, 36, 36, preserveAspectRatio=True, anchor='c')
        c.setFont('Noto', CORPO)
        for i, r in enumerate(testi):
            c.drawString(139, y - 11 - i * 14, r)
        c.drawRightString(513, y - alto / 2 - 3, f"{l['unfulfilledQuantity']} di {l['quantity']}")
        c.setFont('Noto', 7.5)
        for i, (nome, logo) in enumerate(loghi):
            x = 340 + i * 62
            c.drawImage(logo, x, y - 52, 52, 44, preserveAspectRatio=True, anchor='c')
            c.drawCentredString(x + 26, y - 62, nome[:14])
        c.setFont('Noto', CORPO)
        y -= alto + 6

    c.setLineWidth(1.2)
    c.line(91, y, 513, y)
    if y < 130:
        c.showPage()
        testata()
        y = H - 120
    y -= 27
    c.setFont('Noto', CORPO)
    a = shop.get('billingAddress') or {}
    via = ', '.join(x for x in (a.get('address1'), ' '.join(z for z in (a.get('zip'), a.get('city'), a.get('provinceCode')) if z),
                                'Italia' if a.get('countryCodeV2') == 'IT' else a.get('country')) if x)
    c.drawCentredString(CENTRO, y, 'Grazie per aver acquistato da noi!')
    y -= 27
    for r in (shop['name'], via, shop.get('contactEmail'), (shop.get('primaryDomain') or {}).get('host')):
        if r:
            c.drawCentredString(CENTRO, y, r)
            y -= 14
    c.showPage()


def disegna_riepilogo(c, oggi, generale, blocchi):
    """Prima pagina: le cose da fare divise per negozio, ognuna con la sua casella da spuntare."""
    W, H = A4
    X, LARGO = 70, W - 140
    ROSSO, GRIGIO = (0.8, 0.1, 0.1), (0.45, 0.45, 0.45)
    y = [H - 70]

    def spazio(serve):
        if y[0] - serve < 60:
            c.showPage()
            y[0] = H - 70

    def righe(testo, font, corpo, rientro):
        return simpleSplit(testo, font, corpo, LARGO - rientro) or ['']

    def scrivi(testo, font='Noto', corpo=9.5, passo=13, rientro=0, colore=(0, 0, 0)):
        for r in righe(testo, font, corpo, rientro):
            spazio(passo)
            c.setFont(font, corpo)
            c.setFillColorRGB(*colore)
            c.drawString(X + rientro, y[0], r)
            y[0] -= passo
        c.setFillColorRGB(0, 0, 0)

    def casella(testo, urgente):
        r = righe(testo, 'Noto', 10, 20)
        spazio(13 * len(r) + 6)
        c.setStrokeColorRGB(0, 0, 0)
        c.setLineWidth(0.9)
        c.rect(X + 1, y[0] - 2, 10, 10)
        scrivi(testo, corpo=10, rientro=20, colore=ROSSO if urgente else (0, 0, 0))
        y[0] -= 6

    def intestazione(nome, quanti):
        spazio(70)   # Il nome del negozio non resta da solo in fondo alla pagina
        y[0] -= 16
        c.setFont('NotoB', 13)
        c.drawString(X, y[0], nome)
        if quanti:
            c.setFont('Noto', 10)
            c.setFillColorRGB(*GRIGIO)
            c.drawRightString(X + LARGO, y[0], quanti)
            c.setFillColorRGB(0, 0, 0)
        c.setLineWidth(0.6)
        c.line(X, y[0] - 6, X + LARGO, y[0] - 6)
        y[0] -= 24

    scrivi(f'Riepilogo del {data_lunga(oggi)}', 'NotoB', 17.5, 22)
    scrivi('In rosso le cose da sistemare prima di spedire.', colore=GRIGIO, passo=14)
    if generale:
        intestazione('Generale', '')
        for testo, urgente in generale:
            casella(testo, urgente)
    for nome, quanti, fare, info in blocchi:
        intestazione(nome, quanti)
        if not fare:
            scrivi('Niente da fare oggi', colore=GRIGIO, passo=16)
        for testo, urgente in fare:
            casella(testo, urgente)
        for titolo, voci in info:
            if voci:
                scrivi(f"{titolo}: {', '.join(voci)}", corpo=9, passo=12, colore=GRIGIO)
    c.showPage()


# ── File di stampa ──

def crea_pdf_stampa(destinazione, voci, problemi):
    """Una pagina 23x43 per ogni pezzo. Ritorna gli ordini con tutti i file a posto."""
    W, H = PAGINA_STAMPA
    c = canvas.Canvas(str(destinazione), pagesize=PAGINA_STAMPA, pageCompression=1)
    pagine = 0
    falliti = set()
    with tempfile.TemporaryDirectory() as tmp:
        for i, (ordine, titolo, url, pezzi) in enumerate(voci):
            try:
                r = requests.get(url, timeout=120)
                r.raise_for_status()
                f = Path(tmp) / f'{i}.png'
                f.write_bytes(r.content)
                with Image.open(f) as im:
                    w, h = im.size
                if abs(w / h - W / H) > 0.01:
                    raise ValueError(f'formato {w}x{h}, non 23x43')
                for _ in range(pezzi):
                    c.setPageSize(PAGINA_STAMPA)
                    c.drawImage(str(f), 0, 0, W, H, mask='auto')
                    c.showPage()
                    pagine += 1
            except Exception as e:
                falliti.add(ordine)
                problemi.append(f'{ordine}, {titolo}: file di stampa non riuscito ({type(e).__name__}: {str(e)[:80]})')
        if pagine:
            c.save()   # Va salvato qui: i file temporanei servono fino alla scrittura del PDF
    return pagine, falliti


def url_file_stampa(l):
    return next((a['value'] for a in l['customAttributes'] if a['key'] == ATTR_FILE_STAMPA), None)


def file_pronti(o, ora, errori, rimandati):
    """Un ordine col file non pronto passa tutto a domani, così non finisce stampato a metà."""
    ore = (ora - leggi_data(o['createdAt'])).total_seconds() / 3600
    for l in righe_ddt(o):
        url = url_file_stampa(l)
        if not url:
            continue
        try:
            stato = requests.head(url, timeout=30).status_code
        except requests.RequestException as e:
            stato = type(e).__name__
        if stato != 200:
            if ore <= ORE_ATTESA_FILE:
                rimandati.append(f"{o['name']}: file non ancora pronto, l'ordine passa a domani")
            else:
                errori.append(f"{o['name']}, {l['title']}: file di stampa non disponibile ({stato}), l'ordine passa a domani")
            return False
    return True


def nome_libero(cartella, nome):
    """Non sovrascrive mai: se si rilancia nello stesso giorno aggiunge un numero."""
    p = cartella / nome
    n = 2
    while p.exists():
        p = cartella / f'{Path(nome).stem}-{n}{Path(nome).suffix}'
        n += 1
    return p


def conferma_pdf(temporaneo, finale, pagine_attese):
    letti = len(PdfReader(str(temporaneo)).pages)
    if letti != pagine_attese:
        raise RuntimeError(f'{finale.name}: {letti} pagine invece di {pagine_attese}')
    temporaneo.rename(finale)
    return len(PdfReader(str(finale)).pages) == pagine_attese


def pulisci(base, oggi, reg):
    """Pulizia della domenica sera: tocca solo le cartelle con il nome a data."""
    cancellate = 0
    if not base.is_dir():
        reg.scrivi('Cartella non trovata: niente da cancellare')
        return cancellate
    for p in sorted(base.iterdir()):
        if p.is_symlink() or not p.is_dir() or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', p.name):
            continue
        shutil.rmtree(p)
        reg.scrivi(f'{oggi} pulizia: cancellata {p.name}')
        cancellate += 1
    return cancellate


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cartella', required=True, type=Path)
    ap.add_argument('--applica', action='store_true', help='mette davvero il tag su Shopify')
    ap.add_argument('--env', type=Path, default=QUI / '.env')
    ap.add_argument('--pulisci', action='store_true', help='cancella le cartelle dei giorni passati e basta')
    args = ap.parse_args()
    carica_env(args.env)
    if args.pulisci:
        reg = Registro('pulizia')
        try:
            cancellate = pulisci(args.cartella, dt.datetime.now(ROMA).date(), reg)
            reg.scrivi(f'Cartelle cancellate: {cancellate}')
            reg.chiudi('ok', {'cancellate': cancellate})
            return 0
        except Exception:
            reg.scrivi(traceback.format_exc())
            reg.chiudi('errore')
            raise
    registra_font()
    # CS_PROVA nel file .env ferma tag ed esito senza toccare la programmazione
    applica = args.applica and not os.environ.get('CS_PROVA')
    reg = Registro('mattino')
    try:
        codice, stato, riepilogo = giro(args, applica, reg)
        reg.chiudi(stato, riepilogo)
        return codice
    except Exception as e:
        reg.scrivi(traceback.format_exc())
        reg.chiudi('errore' if applica else 'prova')
        if applica:
            # Senza esito scatterebbe comunque il controllo delle 5:30: così il motivo arriva subito
            invia_esito(False, {}, f'{type(e).__name__}: {str(e)[:300]}')
        raise


def giro(args, applica, reg):

    inizio = time.time()
    oggi = dt.datetime.now(ROMA).date()
    cartella = args.cartella / oggi.isoformat()

    errori = []
    errori_negozio = {}
    dati = dati_gestionale()
    # Weekend, festivi e chiusure del Planner: il giorno del rientro fa tutto in un'unica sessione
    if not dati['lavorativo']:
        reg.scrivi(f"{oggi} giorno non lavorativo ({dati.get('motivo')}): nessun giro")
        return 0, 'saltato', {'motivo': dati.get('motivo')}
    cartella.mkdir(parents=True, exist_ok=True)

    # 1. Mail: il cervello le ha già lette; si controlla che il controllo sia davvero aggiornato
    ora = dt.datetime.now(dt.timezone.utc)
    avvisi_mail = []
    for ca in dati['caselle']:
        ultimo = ca.get('ultimo_sync_at')
        vecchio = not ultimo or (ora - leggi_data(ultimo)).total_seconds() > MAIL_VECCHIA_DOPO_MINUTI * 60
        if ca.get('ultimo_errore') or vecchio:
            avvisi_mail.append(f"{ca['indirizzo']}: {ca.get('ultimo_errore') or 'non controllata di recente'}")

    # 2. Ordini di ogni negozio
    # Per negozio, per il riepilogo a checklist: problemi, rimandati e non pagati
    negozi = sorted(dati['negozi'], key=lambda x: x['nome'])
    problemi = {n['id']: [] for n in negozi}
    rimandati = {n['id']: [] for n in negozi}
    non_pagati = {n['id']: [] for n in negozi}
    avvisi_stampa = {n['id']: [] for n in negozi}
    per_negozio = []
    for n in negozi:
        try:
            s = Shopify(n)
            info = s.chiama(NEGOZIO)
            ordini = []
            for o in sorted(s.ordini_da_stampare(), key=lambda o: o['createdAt']):
                if o['displayFinancialStatus'] not in PAGAMENTI_DA_STAMPARE:
                    non_pagati[n['id']].append(f"{o['name']}: {o['displayFinancialStatus']}")
                elif n['id'] not in NEGOZI_FILE_STAMPA or file_pronti(o, ora, problemi[n['id']], rimandati[n['id']]):
                    ordini.append(o)
            per_negozio.append((n, s, info['shop'], {x['handle'] for x in info['currentAppInstallation']['accessScopes']}, ordini))
        except Exception as e:
            problemi[n['id']].append(f"ordini non letti ({type(e).__name__}: {str(e)[:100]})")
        if problemi[n['id']]:
            errori += [f"{n['nome']} {x}" for x in problemi[n['id']]]
            errori_negozio[n['id']] = errori[-1]

    # 3. Richieste di modifica collegate ai DDT
    in_stampa = {(n['id'], o['name']) for n, _, _, _, ordini in per_negozio for o in ordini}
    richieste = {}
    # Chiave None: richieste con un negozio che non è tra quelli letti, finiscono in "Generale"
    altrove = {n['id']: [] for n in negozi}
    senza_ordine = {n['id']: [] for n in negozi}
    nomi = {n['id']: n['nome'] for n in negozi}
    for m in dati['modifiche']:
        testo = (m.get('descrizione') or m.get('titolo') or '').strip()
        chi = m.get('negozio') if m.get('negozio') in nomi else None
        prefisso = '' if chi else f"{m.get('negozio') or 'Negozio non indicato'}: "
        if not m['ordini']:
            senza_ordine.setdefault(chi, []).append(f'{prefisso}{m.get("titolo") or testo}')
        for num in m['ordini']:
            if (m.get('negozio'), num) in in_stampa:
                richieste.setdefault((m['negozio'], num), []).append(testo)
            else:
                altrove.setdefault(chi, []).append(f'{prefisso}{num}: {testo}')

    # 4. File di stampa: esclusi gli ordini da modificare, per non stampare un file sbagliato
    voci_stampa = []
    senza_file = {n['id']: [] for n in negozi}
    esclusi = {n['id']: [] for n in negozi}
    for n, _, _, _, ordini in per_negozio:
        if n['id'] not in NEGOZI_FILE_STAMPA:
            continue
        for o in ordini:
            if (n['id'], o['name']) in richieste:
                esclusi[n['id']].append(o['name'])
                continue
            for l in righe_ddt(o):
                url = url_file_stampa(l)
                if url:
                    voci_stampa.append((n['id'], o['name'], l['title'], url, l['unfulfilledQuantity']))
                else:
                    senza_file[n['id']].append(f"{o['name']}: {l['title']}")

    # Un PDF per negozio: (negozio, ordine) dei file non riusciti, pdf_stampa[negozio] = (file, pagine)
    falliti_stampa = set()
    pdf_stampa = {}
    for i, prefisso in NEGOZI_FILE_STAMPA.items():
        voci = [v[1:] for v in voci_stampa if v[0] == i]
        if not voci:
            continue
        finale = nome_libero(cartella, f'{prefisso}-file-di-stampa-23x43.pdf')
        tmp = finale.with_suffix('.part')
        try:
            pagine, falliti = crea_pdf_stampa(tmp, voci, avvisi_stampa[i])
            falliti_stampa |= {(i, x) for x in falliti}
            if pagine:
                conferma_pdf(tmp, finale, pagine)
                pdf_stampa[i] = (finale, pagine)
        except Exception as e:
            falliti_stampa |= {(i, v[0]) for v in voci}
            errori.append(f"{nomi[i]}: PDF dei file di stampa non riuscito ({type(e).__name__}: {str(e)[:100]})")
            errori_negozio[i] = errori[-1]
            problemi[i].append(errori[-1])
            tmp.unlink(missing_ok=True)

    # 5. PDF dei DDT, con il riepilogo in prima pagina: una checklist per negozio
    generale = [(f'Controllare la posta, potrebbero mancare richieste di modifica: {x}', True) for x in avvisi_mail]
    generale += [(f"Controllare la richiesta su {x} (ordine non in questo PDF)", True) for x in altrove.get(None, [])]
    generale += [(f"Controllare la richiesta senza numero d'ordine: {x}", True) for x in senza_ordine.get(None, [])]
    ordini_di = {n['id']: ordini for n, _, _, _, ordini in per_negozio}
    blocchi = []
    for n in negozi:
        i = n['id']
        ordini = ordini_di.get(i)
        fare = [(f'Risolvere: {x}', True) for x in problemi[i] + avvisi_stampa[i]]
        fare += [(f"Modificare {k[1]}: {' / '.join(v)}", True) for k, v in sorted(richieste.items()) if k[0] == i]
        fare += [(f'Stampare a mano il file di {x} dopo la modifica (escluso dal PDF di stampa)', True) for x in esclusi[i]]
        fare += [(f'Controllare la richiesta su {x} (già stampato, evaso o rimandato)', True) for x in altrove[i]]
        fare += [(f"Controllare la richiesta senza numero d'ordine: {x}", True) for x in senza_ordine[i]]
        if ordini:
            fare.append((f"Stampare i DDT: {len(ordini)} {'ordine' if len(ordini) == 1 else 'ordini'}", False))
        if i in pdf_stampa:
            fare.append((f'Stampare il PDF dei file di stampa: {pdf_stampa[i][1]} pagine', False))
        info = [('Righe senza file di stampa', senza_file[i]), ('Rimandati a domani', rimandati[i]),
                ('Esclusi perché non pagati', non_pagati[i])]
        quanti = 'ordini non letti' if ordini is None else f"{len(ordini)} {'ordine' if len(ordini) == 1 else 'ordini'}"
        blocchi.append((n['nome'], quanti, fare, info))

    finale_ddt = nome_libero(cartella, 'DDT.pdf')
    tmp_ddt = finale_ddt.with_suffix('.part')
    c = canvas.Canvas(str(tmp_ddt), pagesize=A4)
    disegna_riepilogo(c, oggi, generale, blocchi)
    cache = {}
    for n, _, shop, _, ordini in per_negozio:
        for o in ordini:
            disegna_ddt(c, o, shop, richieste.get((n['id'], o['name']), []), cache)
    pagine_ddt = c.getPageNumber() - 1
    c.save()
    conferma_pdf(tmp_ddt, finale_ddt, pagine_ddt)

    # 6. Tag: solo per i DDT salvati e con i file di stampa a posto. Chi resta fuori ripassa domani
    taggati, saltati = 0, []
    fatti = {}
    for n, s, _, permessi, ordini in per_negozio:
        for o in ordini:
            if (n['id'], o['name']) in falliti_stampa:
                saltati.append(f"{n['nome']} {o['name']}: file di stampa non riuscito")
                continue
            if not applica:
                saltati.append(f"{n['nome']} {o['name']}: prova, tag non messo")
                continue
            if 'write_orders' not in permessi:
                saltati.append(f"{n['nome']} {o['name']}: manca il permesso write_orders")
                continue
            try:
                ris = s.chiama(AGGIUNGI_TAG, id=o['id'], tags=[TAG_AUTOMAZIONE])['tagsAdd']
                if ris['userErrors']:
                    raise RuntimeError(ris['userErrors'][0]['message'])
                taggati += 1
                fatti.setdefault(n['id'], []).append(o['name'])
            except Exception as e:
                errori.append(f"{n['nome']} {o['name']}: tag non messo ({str(e)[:80]})")
                errori_negozio[n['id']] = errori[-1]

    bloccati = [x for x in saltati if 'prova' not in x]
    if applica:
        for i, avvisi in avvisi_stampa.items():
            if avvisi:
                errori_negozio[i] = avvisi[-1]
        esito = {n['id']: {'fatti': fatti.get(n['id'], []), 'errore': errori_negozio.get(n['id'])} for n in dati['negozi']}
        risposta = invia_esito(not errori_negozio, esito)
        reg.scrivi(f"Centro di controllo: {risposta['ordini_avanzati']} ordini passati alla preparazione")
    n_ordini = sum(len(x[4]) for x in per_negozio)
    pagine_stampa = sum(x[1] for x in pdf_stampa.values())
    mb_stampa = sum(x[0].stat().st_size for x in pdf_stampa.values()) // 1024 ** 2
    reg.scrivi(f"--- {dt.datetime.now(ROMA):%Y-%m-%d %H:%M} {'giro vero' if applica else 'prova, nessun tag'}")
    reg.scrivi(f"Cartella: {cartella}")
    reg.scrivi(f"DDT: {n_ordini} ordini, {pagine_ddt} pagine, {finale_ddt.stat().st_size // 1024} KB")
    reg.scrivi(f"Stampa: {pagine_stampa} pagine, {mb_stampa} MB"
               + ''.join(f" ({nomi[i]}: {x[1]})" for i, x in sorted(pdf_stampa.items())))
    conta = lambda d: sum(len(v) for v in d.values())
    reg.scrivi(f"Non pagati esclusi: {conta(non_pagati)}, rimandati a domani: {conta(rimandati)}")
    reg.scrivi(f"Da modificare: {len(richieste)}, altre richieste da controllare: {conta(altrove) + conta(senza_ordine)}, righe senza file: {conta(senza_file)}")
    reg.scrivi(f"Tag messi: {taggati}, non messi: {len(saltati)}, tempo: {time.time() - inizio:.0f} s")
    for x in errori + [x for v in avvisi_stampa.values() for x in v] + avvisi_mail + bloccati:
        reg.scrivi(f'ATTENZIONE: {x}')
    # Lo stesso contenuto del riepilogo in prima pagina del PDF
    for nome, quanti, fare, info in ([('Generale', '', generale, [])] if generale else []) + blocchi:
        reg.scrivi(f"\n{nome}{f' ({quanti})' if quanti else ''}")
        for testo, _ in fare:
            reg.scrivi(f'[ ] {testo}')
        for titolo, voci in info:
            if voci:
                reg.scrivi(f"    {titolo}: {', '.join(voci)}")
    codice = 1 if errori or any(avvisi_stampa.values()) or avvisi_mail or bloccati else 0
    stato = ('errore' if codice else 'ok') if applica else 'prova'
    return codice, stato, {'ordini': n_ordini, 'pagine_stampa': pagine_stampa, 'tag': taggati}


if __name__ == '__main__':
    sys.exit(main())
