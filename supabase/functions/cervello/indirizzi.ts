// T&C Factory — Cambio dell'indirizzo di spedizione su Shopify.
//
// Due strade, entrambe eseguite da applicaIndirizzi a ogni giro del cervello:
//   • analisi.indirizzo_stato = 'da_applicare': l'ha deciso il cervello, solo se la mail passa
//     tutti i controlli di indirizzoDaMail; l'ordine già stampato resta a una persona
//   • analisi.indirizzo_stato = 'approvato': l'ha chiesto una persona, anche su ordine già stampato
// In entrambi i casi l'ordine dev'essere ancora da evadere nel momento della modifica.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { API_VERSION, getToken, type Store } from '../_shared/shopify.ts';

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const senzaCancelletto = (n: unknown) => String(n ?? '').replace(/^#/, '').trim();
const dominio = (email: string) => email.split('@')[1] || '';

// Dal modulo contatti del sito chiunque può scrivere l'email di un altro cliente
const daModuloContatti = (mail: Row) => /@shopify\.com>?$/i.test(mail.message_id || '');

// Il mittente è autentico solo se il server Aruba l'ha verificato (DMARC, o DKIM del suo stesso dominio)
export function mittenteVerificato(autenticazione: string | null | undefined, mittente: string) {
  const r = (autenticazione || '').toLowerCase();
  if (!/^[^;]*aruba/.test(r)) return false;
  if (/\bdmarc=pass\b/.test(r)) return true;
  const d = dominio(mittente).replace(/[.]/g, '\\.');
  return !!d && new RegExp(`\\bdkim=pass\\b[^;]*header\\.(d=|i=@)${d}\\b`).test(r);
}

// Campi obbligatori presenti e sensati, stesso paese dell'ordine (un altro paese cambia la spedizione)
export function indirizzoCompleto(n: Row, paeseOrdine: string) {
  const paese = (n.paese || '').toUpperCase();
  if (!/\d/.test(n.via || '') || !(n.citta || '').trim() || !(n.cap || '').trim()) return false;
  if (!paese || paese !== (paeseOrdine || '').toUpperCase()) return false;
  return paese !== 'IT' || (/^\d{5}$/.test(n.cap.trim()) && /^[A-Za-z]{2}$/.test((n.provincia || '').trim()));
}

// Campi da aggiungere all'analisi se il cambio può partire da solo; null se resta a una persona
export function indirizzoDaMail(a: Row, mail: Row, mittente: string, ordini: Row[]): Row | null {
  if (a.categoria !== 'modifica_ordine' || a.modifica !== 'indirizzo' || (a.dubbi || '').trim()) return null;
  if (daModuloContatti(mail) || !mittenteVerificato(mail.autenticazione, mittente)) return null;
  const cercato = senzaCancelletto(a.ordine_modifica);
  const trovati = ordini.filter(o => senzaCancelletto(o.numero) === cercato);
  if (!cercato || trovati.length !== 1 || (trovati[0].email || '').toLowerCase() !== mittente) return null;
  if (!indirizzoCompleto(a.nuovo_indirizzo || {}, trovati[0].indirizzo?.paese)) return null;
  return {
    indirizzo_stato: 'da_applicare',
    indirizzo_nuovo: a.nuovo_indirizzo,
    indirizzo_ordine: { negozio: trovati[0].store_id, numero: trovati[0].numero },
  };
}

async function shopify(store: Store, token: string, query: string, variables: Row) {
  const res = await fetch(`https://${store.dominio}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  if (json.errors?.length) throw new Error(`Shopify: ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.data;
}

const LEGGI = `query($id: ID!) { order(id: $id) { displayFulfillmentStatus cancelledAt tags
  shippingAddress { firstName lastName company phone } } }`;
const AGGIORNA = `mutation($input: OrderInput!) { orderUpdate(input: $input) { userErrors { field message } } }`;

async function applica(db: SupabaseClient, t: Row) {
  const a = t.analisi;
  const { negozio, numero } = a.indirizzo_ordine;
  const [{ data: store }, { data: ordine }] = await Promise.all([
    db.from('shopify_stores').select('id, nome, dominio, client_id').eq('id', negozio).maybeSingle(),
    db.from('shopify_orders').select('shopify_id').eq('store_id', negozio).eq('numero', numero).maybeSingle(),
  ]);
  if (!store || !ordine) throw new Error(`Ordine ${numero} non trovato`);

  const token = await getToken(db, store as Store);
  const { order } = await shopify(store as Store, token, LEGGI, { id: ordine.shopify_id });
  if (!order) throw new Error(`Ordine ${numero} non trovato su Shopify`);

  // Lo stato si rilegge ora: non è un guasto, il task resta a una persona
  const stampato = (order.tags || []).some((x: string) => ['stampato', 'auto-stampato'].includes(x.toLowerCase()));
  const blocco = order.cancelledAt ? 'ordine annullato'
    : order.displayFulfillmentStatus !== 'UNFULFILLED' ? `ordine non più da evadere (${order.displayFulfillmentStatus})`
    : a.indirizzo_stato === 'da_applicare' && stampato ? 'ordine già stampato: sui fogli c\'è il vecchio indirizzo'
    : '';
  if (blocco) return { blocco };

  const n = a.indirizzo_nuovo, ora = order.shippingAddress || {};
  const { orderUpdate } = await shopify(store as Store, token, AGGIORNA, { input: {
    id: ordine.shopify_id,
    shippingAddress: {
      firstName: ora.firstName, lastName: ora.lastName, company: ora.company, phone: ora.phone,
      address1: n.via.trim(), address2: (n.presso || '').trim() || null,
      city: n.citta.trim(), zip: n.cap.trim(), provinceCode: (n.provincia || '').trim().toUpperCase() || null,
      countryCode: n.paese.toUpperCase(),
    },
  } });
  if (orderUpdate.userErrors?.length) throw new Error(`Shopify: ${orderUpdate.userErrors.map((e: Row) => e.message).join('; ').slice(0, 300)}`);
  return { blocco: '' };
}

export async function applicaIndirizzi(db: SupabaseClient) {
  const { data: tasks } = await db.from('tasks').select('id, analisi')
    .in('analisi->>indirizzo_stato', ['da_applicare', 'approvato'])
    .not('stato', 'in', '(completato,non_completato)').limit(10);

  for (const t of (tasks || []) as Row[]) {
    const salva = (extra: Row, resto: Row = {}) => db.from('tasks').update({ analisi: { ...t.analisi, ...extra }, ...resto }).eq('id', t.id);
    try {
      const { blocco } = await applica(db, t);
      if (blocco) {
        await salva({ indirizzo_stato: 'fermato', dubbi: `Indirizzo NON cambiato in automatico: ${blocco}.` });
      } else {
        await salva({ indirizzo_stato: 'applicato' }, { stato: 'completato', motivo: 'Indirizzo cambiato su Shopify da CS' });
      }
    } catch (e) {
      const motivo = `Cambio indirizzo non riuscito: ${e instanceof Error ? e.message : e}`;
      console.error('Indirizzo', t.id, motivo);
      await salva({ indirizzo_stato: 'errore', dubbi: motivo.slice(0, 300) });
      await db.rpc('_tc_automazione_fallita', { p_id: t.id, p_motivo: motivo });
    }
  }
}
