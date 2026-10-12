// T&C Factory — Importa un prodotto da un link
//
// Apre la pagina del prodotto e ne ricava più informazioni possibili:
// dati strutturati schema.org (JSON-LD), meta tag Open Graph / prodotto e,
// per i negozi Shopify, il JSON del prodotto (varianti con colori e taglie).
// Restituisce i campi del modulo prodotto: catalogo, codice, descrizione, colori, taglie, prezzo.
// Chi chiama deve essere collegato e far parte dello staff (app_users).
//
// Deploy: supabase functions deploy product-import --project-ref <ref> --use-api --no-verify-jwt
// (il token viene verificato qui dentro con auth.getUser)

import { createClient } from 'npm:@supabase/supabase-js@2';

const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 5;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (error: string, status = 400) => reply({ success: false, error }, status);

// ─────────────────────────────────────────────
// Sicurezza: niente indirizzi interni (localhost, reti private, metadati cloud)
// ─────────────────────────────────────────────

function isPrivateIp(ip: string): boolean {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('::ffff:');
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Link non valido'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Il link deve iniziare con http:// o https://');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Link non consentito');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host.includes('.') || /^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error('Link non consentito');
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    if (isPrivateIp(host)) throw new Error('Link non consentito');
    return url;
  }
  const ips: string[] = [];
  for (const type of ['A', 'AAAA'] as const) {
    try { ips.push(...await Deno.resolveDns(host, type)); } catch { /* record assente */ }
  }
  if (!ips.length) throw new Error('Sito non raggiungibile');
  if (ips.some(isPrivateIp)) throw new Error('Link non consentito');
  return url;
}

// Scarica seguendo i redirect a mano, controllando ogni passaggio
async function fetchPublic(raw: string, accept: string): Promise<{ url: URL; text: string; type: string }> {
  let url = await assertPublicUrl(raw);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Accept': accept,
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
      },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = await assertPublicUrl(new URL(res.headers.get('location')!, url).href);
      continue;
    }
    if (!res.ok) throw new Error(`Il sito ha risposto con errore ${res.status}`);
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { await reader.cancel(); break; }
      chunks.push(value);
    }
    const buf = new Uint8Array(size > MAX_BYTES ? MAX_BYTES : size);
    let off = 0;
    for (const c of chunks) { if (off + c.length > buf.length) break; buf.set(c, off); off += c.length; }
    return { url, text: new TextDecoder().decode(buf.subarray(0, off)), type: res.headers.get('content-type') || '' };
  }
  throw new Error('Troppi reindirizzamenti');
}

// ─────────────────────────────────────────────
// Estrazione
// ─────────────────────────────────────────────

type Found = {
  catalogo?: string; codice?: string; descrizione?: string;
  colori: string[]; taglie: string[]; prezzo?: number; valuta?: string; fonti: string[];
};

const decodeEntities = (s: string) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const clean = (v: unknown) => typeof v === 'string' || typeof v === 'number'
  ? decodeEntities(String(v)).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
const firstOf = (...vals: unknown[]) => vals.map(clean).find(Boolean) || undefined;
const toPrice = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^\d.,]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined;
};
const addUnique = (list: string[], v: unknown) => {
  for (const part of (Array.isArray(v) ? v : [v])) {
    const c = clean(part);
    if (c && !list.some(x => x.toLowerCase() === c.toLowerCase())) list.push(c);
  }
};
const COLOR_RE = /^(colou?re?s?|farbe|couleur|kleur)$/i;
const SIZE_RE  = /^(size|sizes|taglia|taglie|misura|misure|gr(ö|o)(ß|ss)e|taille|maat)$/i;

function metaTags(html: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = (tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const val = (tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1];
    if (key && val && !map.has(key.toLowerCase())) map.set(key.toLowerCase(), decodeEntities(val));
  }
  return map;
}

function jsonLdNodes(html: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') {
      const o = n as Record<string, unknown>;
      nodes.push(o);
      if (o['@graph']) walk(o['@graph']);
    }
  };
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* JSON non valido */ }
  }
  return nodes;
}
const hasType = (o: Record<string, unknown>, t: string) =>
  ([] as unknown[]).concat(o['@type'] ?? []).some(x => String(x).toLowerCase() === t.toLowerCase());

function fromJsonLd(html: string, f: Found) {
  const products = jsonLdNodes(html).filter(o => hasType(o, 'Product') || hasType(o, 'ProductGroup'));
  if (!products.length) return;
  f.fonti.push('dati strutturati');
  const p = products.find(o => hasType(o, 'ProductGroup')) || products[0];
  const brand = p.brand as Record<string, unknown> | string | undefined;
  f.catalogo ??= firstOf(typeof brand === 'object' ? brand?.name : brand, (p.manufacturer as Record<string, unknown>)?.name);
  f.codice ??= firstOf(p.productGroupID, p.sku, p.mpn, p.productID, p.model);
  f.descrizione ??= firstOf(p.name);

  const variants = ([] as Record<string, unknown>[]).concat((p.hasVariant as Record<string, unknown>[]) ?? [], products.filter(o => o !== p));
  for (const v of [p, ...variants]) {
    addUnique(f.colori, v.color);
    addUnique(f.taglie, v.size);
    for (const prop of ([] as Record<string, unknown>[]).concat((v.additionalProperty as Record<string, unknown>[]) ?? [])) {
      if (COLOR_RE.test(clean(prop.name))) addUnique(f.colori, prop.value);
      if (SIZE_RE.test(clean(prop.name)))  addUnique(f.taglie, prop.value);
    }
  }
  const offers = ([] as Record<string, unknown>[]).concat((p.offers as Record<string, unknown>[]) ?? [], ...variants.map(v => ([] as Record<string, unknown>[]).concat((v.offers as Record<string, unknown>[]) ?? [])));
  for (const o of offers) {
    const price = toPrice(o.lowPrice ?? o.price ?? (o.priceSpecification as Record<string, unknown>)?.price);
    if (price && (!f.prezzo || price < f.prezzo)) { f.prezzo = price; f.valuta = clean(o.priceCurrency) || f.valuta; }
  }
}

function fromMeta(html: string, url: URL, f: Found) {
  const m = metaTags(html);
  if (m.size) f.fonti.push('meta tag');
  f.catalogo ??= firstOf(m.get('product:brand'), m.get('og:brand'), m.get('brand'));
  f.codice ??= firstOf(m.get('product:retailer_item_id'), m.get('sku'), m.get('mpn'), m.get('productid'));
  f.descrizione ??= firstOf(m.get('og:title'), m.get('twitter:title'), m.get('name'), (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  addUnique(f.colori, m.get('product:color') ?? m.get('color'));
  addUnique(f.taglie, m.get('product:size'));
  if (!f.prezzo) {
    f.prezzo = toPrice(m.get('product:price:amount') ?? m.get('og:price:amount') ?? m.get('price'));
    f.valuta = firstOf(m.get('product:price:currency'), m.get('og:price:currency'), m.get('pricecurrency')) || f.valuta;
  }
  // Ultima spiaggia per il catalogo: il nome del sito
  f.catalogo ??= firstOf(m.get('og:site_name'), url.hostname.replace(/^www\./, ''));
}

// Negozi Shopify: /products/<handle>.js restituisce varianti e opzioni
async function fromShopify(url: URL, f: Found) {
  const m = url.pathname.match(/^(.*\/products\/[^/?#]+)/);
  if (!m) return;
  let data: Record<string, unknown>;
  try {
    const { text } = await fetchPublic(`${url.origin}${m[1].replace(/\.(js|json)$/, '')}.js`, 'application/json');
    data = JSON.parse(text);
  } catch { return; }
  if (!data || !Array.isArray(data.variants)) return;
  f.fonti.push('Shopify');
  f.catalogo = firstOf(data.vendor) ?? f.catalogo;
  f.descrizione = firstOf(data.title) ?? f.descrizione;
  const variants = data.variants as Record<string, unknown>[];
  f.codice ??= firstOf(variants[0]?.sku);
  for (const opt of (data.options as Record<string, unknown>[]) || []) {
    const name = clean(typeof opt === 'string' ? opt : opt.name);
    const values = typeof opt === 'object' ? opt.values : undefined;
    if (COLOR_RE.test(name)) addUnique(f.colori, values);
    if (SIZE_RE.test(name))  addUnique(f.taglie, values);
  }
  const prices = variants.map(v => Number(v.price)).filter(n => n > 0);
  if (prices.length) f.prezzo = Math.round(Math.min(...prices)) / 100;   // Shopify: centesimi
}

// ─────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('Metodo non consentito', 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: caller } = await admin.auth.getUser(token);
  if (!caller?.user) return fail('Accesso richiesto', 401);
  const { data: me } = await admin.from('app_users').select('nickname').eq('auth_id', caller.user.id).maybeSingle();
  if (!me) return fail('Accesso riservato allo staff', 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail('Richiesta non valida'); }
  const link = String(body.url || '').trim();
  if (!link || link.length > 2000) return fail('Inserisci un link');

  try {
    const page = await fetchPublic(link, 'text/html,application/xhtml+xml');
    const f: Found = { colori: [], taglie: [], fonti: [] };
    await fromShopify(page.url, f);
    fromJsonLd(page.text, f);
    fromMeta(page.text, page.url, f);

    return reply({
      success: true,
      prodotto: {
        catalogo: f.catalogo || '',
        codice: f.codice || '',
        descrizione: f.descrizione || '',
        colori: f.colori.join(', '),
        taglie: f.taglie.join(', '),
        prezzo: f.prezzo ?? null,
        valuta: f.valuta || '',
      },
      fonti: f.fonti,
      url: page.url.href,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (e instanceof DOMException && e.name === 'TimeoutError') return fail('Il sito non ha risposto in tempo');
    return fail(msg && !/fetch|network|dns|tls|connect/i.test(msg) ? msg : 'Impossibile aprire il link');
  }
});
