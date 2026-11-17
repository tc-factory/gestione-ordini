// T&C Factory — Commit dei progetti → task completati di chi fa lo sviluppo con Claude Code
//
// Ogni 10 minuti (cron del database, intestazione x-sync-key) legge i commit su main
// degli ultimi 2 giorni di Creative System, Live Printing e Kamon e registra quelli nuovi
// con tc_registra_commit (sql/task-commit-github.sql): un task completato per commit,
// titolo = prima riga, tempo = minuti dal commit precedente dello stesso progetto.
//
// Secret:
//   SHOPIFY_SYNC_KEY   chiave condivisa con il cron (la stessa di shopify-sync)
//   GITHUB_TOKEN       facoltativo: token di sola lettura per i progetti privati (Live Printing, Kamon).
//                      Senza, si legge solo Creative System, che è pubblico.
// Va pubblicata con --no-verify-jwt: il controllo di chi chiama lo fa lei.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { PROGETTI, commitInTask, type CommitGitHub } from '../_shared/commit.ts';

const GIORNI = 2;

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const syncKey = Deno.env.get('SHOPIFY_SYNC_KEY');
  if (!syncKey || req.headers.get('x-sync-key') !== syncKey) return reply({ success: false, error: 'Non autorizzato' }, 401);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const token = Deno.env.get('GITHUB_TOKEN');
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'tc-factory-github-sync' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const dal = new Date(Date.now() - GIORNI * 86400_000);
  // Un giorno in più per conoscere il commit precedente al primo
  const since = new Date(+dal - 86400_000).toISOString();
  const esito: Record<string, string | number> = {};

  for (const repo of Object.keys(PROGETTI)) {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/commits?sha=main&per_page=100&since=${since}`, { headers });
      if (!res.ok) { esito[repo] = res.status === 404 ? 'non leggibile (privato senza GITHUB_TOKEN?)' : `errore ${res.status}`; continue; }
      const commits = await res.json() as CommitGitHub[];
      let nuovi = 0;
      for (const c of commitInTask(repo, commits, dal)) {
        const { data, error } = await db.rpc('tc_registra_commit', { p: c });
        if (error) throw error;
        if (data) nuovi++;
      }
      esito[repo] = nuovi;
    } catch (e) {
      esito[repo] = `errore: ${(e as Error).message}`;
    }
  }
  return reply({ success: true, nuovi: esito });
});
