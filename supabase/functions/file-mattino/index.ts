// T&C Factory — File del mattino: caricamento e pulizia per lo script del mattino
//
// Lo script (automazioni/shopify-mattino) non ha chiavi del database: con la sua chiave (Vault,
// 'automazione_mattino_key') chiede qui
//   { chiave, azione: 'carica', percorsi: ['2026-11-16/DDT.pdf', ...] } → un link di caricamento per file
//   { chiave, azione: 'scarica', percorso } → link per scaricare (agente di stampa, automazioni/stampa)
//   { chiave, azione: 'pulisci' } → cancella le cartelle dei giorni, tranne l'ultima (come sul Mac in sede),
//       anche dentro prova-server/
//   { chiave, azione: 'libreria' } → elenco della libreria DTF (bucket dtf-libreria) con peso, data e link
//       per scaricarla: la usa il server del mattino, che non ha la cartella del Mac in sede (sql/dtf-libreria.sql)
// I file finiscono nel bucket privato file-mattino; la scheda "File del mattino" li elenca (sql/file-mattino.sql).
// Nelle mattine di prova il server carica in prova-server/AAAA-MM-GG/...: la scheda non le mostra.
//
// Va pubblicata con --no-verify-jwt: il controllo di chi chiama lo fa lei.

import { createClient } from 'npm:@supabase/supabase-js@2';

const BUCKET = 'file-mattino';
const LIBRERIA = 'dtf-libreria';
const PROVA = 'prova-server';
const GIORNO = /^\d{4}-\d{2}-\d{2}$/;
// Cartella del giorno (anche dentro prova-server/), al massimo una sottocartella (fogli DTF), niente percorsi strani
const PERCORSO = /^(?:prova-server\/)?\d{4}-\d{2}-\d{2}\/(?:[^/]+\/)?[^/]+$/;

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fail = (error: string, status = 400) => reply({ success: false, error }, status);

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

type Voce = { percorso: string; peso: number; data: string };

async function elenca(prefisso: string, bucket = BUCKET): Promise<Voce[]> {
  const file: Voce[] = [];
  for (let da = 0; ; da += 1000) {
    const { data, error } = await db.storage.from(bucket).list(prefisso, { limit: 1000, offset: da });
    if (error) throw error;
    for (const x of data || []) {
      const p = prefisso ? `${prefisso}/${x.name}` : x.name;
      if (x.id) file.push({ percorso: p, peso: Number(x.metadata?.size ?? 0), data: x.updated_at ?? '' });
      else file.push(...await elenca(p, bucket));
    }
    if ((data || []).length < 1000) return file;
  }
}

// Le cartelle dei giorni di una radice ('' o prova-server), tranne l'ultima generata
async function pulisci(radice: string) {
  const { data, error } = await db.storage.from(BUCKET).list(radice, { limit: 1000 });
  if (error) throw error;
  const giorni = (data || []).filter(x => !x.id && GIORNO.test(x.name)).map(x => x.name).sort();
  // L'ultima generazione (di solito il venerdì) si stampa ancora il lunedì
  const tenuta = giorni.pop() ?? null;
  const cancellate: string[] = [];
  for (const g of giorni) {
    const cartella = radice ? `${radice}/${g}` : g;
    const file = (await elenca(cartella)).map(x => x.percorso);
    for (let i = 0; i < file.length; i += 100) {
      const { error: e } = await db.storage.from(BUCKET).remove(file.slice(i, i + 100));
      if (e) throw new Error(`${cartella}: ${e.message}`);
    }
    await db.from('file_mattino_stampe').delete().like('percorso', `${cartella}/%`);
    cancellate.push(cartella);
  }
  return { tenuta, cancellate };
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

  // L'agente di stampa in sede, se il file non è già sul suo disco
  if (body.azione === 'scarica') {
    const p = (body as { percorso?: unknown }).percorso;
    if (typeof p !== 'string' || !PERCORSO.test(p) || p.includes('..')) return fail('Percorso non valido');
    const { data, error } = await db.storage.from(BUCKET).createSignedUrl(p, 3600);
    if (error) return fail(`${p}: ${error.message}`, 404);
    return reply({ success: true, link: data.signedUrl });
  }

  if (body.azione === 'pulisci') {
    try {
      const veri = await pulisci('');
      const prova = await pulisci(PROVA);
      return reply({ success: true, tenuta: veri.tenuta, cancellate: [...veri.cancellate, ...prova.cancellate] });
    } catch (e) {
      return fail((e as Error).message, 500);
    }
  }

  // Il server del mattino: elenco della libreria DTF con i link per scaricare i file nuovi o cambiati
  if (body.azione === 'libreria') {
    try {
      const file = await elenca('', LIBRERIA);
      const link: Record<string, string> = {};
      for (let i = 0; i < file.length; i += 200) {
        const { data, error } = await db.storage.from(LIBRERIA).createSignedUrls(file.slice(i, i + 200).map(x => x.percorso), 3600);
        if (error) throw error;
        for (const x of data || []) if (x.path && x.signedUrl) link[x.path] = x.signedUrl;
      }
      return reply({ success: true, file: file.map(x => ({ ...x, link: link[x.percorso] })) });
    } catch (e) {
      return fail((e as Error).message, 500);
    }
  }

  return fail('Azione sconosciuta');
});
