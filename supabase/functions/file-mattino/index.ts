// T&C Factory — File del mattino: caricamento e pulizia per lo script del mattino
//
// Lo script (automazioni/shopify-mattino) non ha chiavi del database: con la sua chiave (Vault,
// 'automazione_mattino_key') chiede qui
//   { chiave, azione: 'carica', percorsi: ['2026-11-16/DDT.pdf', ...] } → un link di caricamento per file
//   { chiave, azione: 'pulisci' } → cancella le cartelle dei giorni, tranne l'ultima (come sul Mac in sede)
// I file finiscono nel bucket privato file-mattino; la scheda "File del mattino" li elenca (sql/file-mattino.sql).
//
// Va pubblicata con --no-verify-jwt: il controllo di chi chiama lo fa lei.

import { createClient } from 'npm:@supabase/supabase-js@2';

const BUCKET = 'file-mattino';
const GIORNO = /^\d{4}-\d{2}-\d{2}$/;
// Cartella del giorno, al massimo una sottocartella (fogli DTF), niente percorsi strani
const PERCORSO = /^\d{4}-\d{2}-\d{2}\/(?:[^/]+\/)?[^/]+$/;

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fail = (error: string, status = 400) => reply({ success: false, error }, status);

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

async function elenca(prefisso: string): Promise<string[]> {
  const { data, error } = await db.storage.from(BUCKET).list(prefisso, { limit: 1000 });
  if (error) throw error;
  const file: string[] = [];
  for (const x of data || []) {
    const p = `${prefisso}/${x.name}`;
    if (x.id) file.push(p);
    else file.push(...await elenca(p));
  }
  return file;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return fail('Solo POST', 405);
  let body: { chiave?: string; azione?: string; percorsi?: unknown };
  try { body = await req.json(); } catch { return fail('Richiesta non valida'); }

  const { data: ok, error: errChiave } = await db.rpc('_tc_mattino_chiave_ok', { p_chiave: body.chiave ?? null });
  if (errChiave) return fail(errChiave.message, 500);
  if (!ok) return fail('Chiave non valida', 401);

  if (body.azione === 'carica') {
    const percorsi = Array.isArray(body.percorsi) ? body.percorsi : [];
    if (!percorsi.length || percorsi.length > 500) return fail('Percorsi mancanti');
    const link: Record<string, string> = {};
    for (const p of percorsi) {
      if (typeof p !== 'string' || !PERCORSO.test(p) || p.includes('..')) return fail(`Percorso non valido: ${p}`);
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(p, { upsert: true });
      if (error) return fail(`${p}: ${error.message}`, 500);
      link[p] = data.signedUrl;
    }
    return reply({ success: true, link });
  }

  if (body.azione === 'pulisci') {
    const { data, error } = await db.storage.from(BUCKET).list('', { limit: 1000 });
    if (error) return fail(error.message, 500);
    const giorni = (data || []).filter(x => !x.id && GIORNO.test(x.name)).map(x => x.name).sort();
    // L'ultima generazione (di solito il venerdì) si stampa ancora il lunedì
    const tenuta = giorni.pop() ?? null;
    const cancellate: string[] = [];
    for (const g of giorni) {
      const file = await elenca(g);
      for (let i = 0; i < file.length; i += 100) {
        const { error: e } = await db.storage.from(BUCKET).remove(file.slice(i, i + 100));
        if (e) return fail(`${g}: ${e.message}`, 500);
      }
      cancellate.push(g);
    }
    return reply({ success: true, tenuta, cancellate });
  }

  return fail('Azione sconosciuta');
});
