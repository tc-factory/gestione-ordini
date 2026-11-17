// T&C Factory — Commit dei progetti → task completati (usato da github-sync e dal recupero dello storico)

export const PROGETTI: Record<string, string> = {
  'tc-system/creative-system': 'Creative System',
  'tc-system/live-printing': 'Live Printing',
  'tc-system/kamon': 'Kamon',
};

const PAUSA_MAX_MIN = 120;   // oltre: il commit apre una sessione nuova, tempo non misurabile
const MINUTI_SENZA_PRECEDENTE = 20;

export type CommitGitHub = {
  sha: string;
  html_url: string;
  parents: { sha: string }[];
  commit: { message: string; author: { date: string } | null; committer: { date: string } | null };
};

export type CommitTask = {
  sha: string; repo: string; progetto: string; url: string;
  at: string; titolo: string; descrizione: string; minuti: number;
};

// Prima riga = titolo; il resto senza le righe di attribuzione
function testo(message: string) {
  const righe = message.split('\n');
  const titolo = righe[0].trim();
  const resto = righe.slice(1)
    .filter(r => !/^(Co-Authored-By:|🤖 Generated with|Signed-off-by:)/i.test(r.trim()))
    .join('\n').trim();
  return { titolo, resto };
}

// Commit di un progetto (qualsiasi ordine) → task dei commit dal momento `dal`, con i minuti dal commit precedente
export function commitInTask(repo: string, commits: CommitGitHub[], dal: Date): CommitTask[] {
  const quando = (c: CommitGitHub) => new Date(c.commit.author?.date || c.commit.committer?.date || 0);
  const veri = commits.filter(c => c.parents.length < 2 && !/^Merge (pull request|branch)/.test(c.commit.message))
    .sort((a, b) => +quando(a) - +quando(b));
  return veri.flatMap((c, i) => {
    const at = quando(c);
    if (at < dal) return [];
    const prima = i > 0 ? (+at - +quando(veri[i - 1])) / 60000 : Infinity;
    const minuti = prima <= PAUSA_MAX_MIN ? Math.max(1, Math.round(prima)) : MINUTI_SENZA_PRECEDENTE;
    const { titolo, resto } = testo(c.commit.message);
    if (!titolo) return [];
    return [{
      sha: c.sha, repo, progetto: PROGETTI[repo] || repo, url: c.html_url, at: at.toISOString(),
      titolo, descrizione: [resto, c.html_url].filter(Boolean).join('\n\n'), minuti,
    }];
  });
}
