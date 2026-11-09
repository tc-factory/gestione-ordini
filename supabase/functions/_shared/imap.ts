// T&C Factory — Client IMAP minimo per Aruba.
// Esiste perché imapflow, su Supabase Edge, resta appeso sulle risposte lunghe.
// Un comando alla volta, ogni comando con un limite di tempo.

type Risposta = { testo: string; literal: Uint8Array[] };

export class Imap {
  private conn!: Deno.TlsConn;
  private buf = new Uint8Array(0);
  private n = 0;

  async apri(host: string) {
    this.conn = await this.limite(Deno.connectTls({ hostname: host, port: 993 }), 20_000, 'collegamento');
    await this.limite(this.risposta(), 20_000, 'saluto del server');
  }

  chiudi() { try { this.conn?.close(); } catch { /* già chiusa */ } }

  private limite<T>(lavoro: Promise<T>, ms: number, passo: string): Promise<T> {
    let timer: number;
    const scaduto = new Promise<T>((_, no) => { timer = setTimeout(() => { this.chiudi(); no(new Error(`IMAP bloccato su: ${passo}`)); }, ms); });
    return Promise.race([lavoro, scaduto]).finally(() => clearTimeout(timer));
  }

  private async riempi() {
    const pezzo = new Uint8Array(65_536);
    const letti = await this.conn.read(pezzo);
    if (letti === null) throw new Error('Connessione IMAP chiusa dal server');
    const unito = new Uint8Array(this.buf.length + letti);
    unito.set(this.buf);
    unito.set(pezzo.subarray(0, letti), this.buf.length);
    this.buf = unito;
  }

  private async riga(): Promise<string> {
    for (;;) {
      const i = this.buf.findIndex((b, k) => b === 13 && this.buf[k + 1] === 10);
      if (i >= 0) {
        const r = new TextDecoder().decode(this.buf.subarray(0, i));
        this.buf = this.buf.subarray(i + 2);
        return r;
      }
      await this.riempi();
    }
  }

  private async byte(quanti: number): Promise<Uint8Array> {
    while (this.buf.length < quanti) await this.riempi();
    const r = this.buf.slice(0, quanti);
    this.buf = this.buf.subarray(quanti);
    return r;
  }

  // Una risposta intera: righe unite, con i blocchi {n} di byte a parte
  private async risposta(): Promise<Risposta> {
    let testo = '';
    const literal: Uint8Array[] = [];
    for (;;) {
      const r = await this.riga();
      testo += r;
      const m = r.match(/\{(\d+)\}$/);
      if (!m) return { testo, literal };
      literal.push(await this.byte(Number(m[1])));
    }
  }

  async comando(cmd: string, ms = 30_000, passo = cmd.split(' ').slice(0, 2).join(' ')): Promise<Risposta[]> {
    const tag = `A${++this.n}`;
    return await this.limite((async () => {
      await this.conn.write(new TextEncoder().encode(`${tag} ${cmd}\r\n`));
      const out: Risposta[] = [];
      for (;;) {
        const r = await this.risposta();
        if (r.testo.startsWith(`${tag} `)) {
          if (!r.testo.startsWith(`${tag} OK`)) throw new Error(`IMAP ${passo}: ${r.testo.slice(tag.length + 1, 160)}`);
          return out;
        }
        out.push(r);
      }
    })(), ms, passo);
  }

  // Salva una mail in una cartella: il server chiede i byte con "+" dopo l'annuncio della dimensione
  async append(cartella: string, raw: Uint8Array, ms = 15_000) {
    const tag = `A${++this.n}`;
    await this.limite((async () => {
      await this.conn.write(new TextEncoder().encode(`${tag} APPEND ${quota(cartella)} (\\Seen) {${raw.length}}\r\n`));
      const pronto = await this.risposta();
      if (!pronto.testo.startsWith('+')) throw new Error(`IMAP APPEND: ${pronto.testo.slice(0, 120)}`);
      await this.conn.write(raw);
      await this.conn.write(new TextEncoder().encode('\r\n'));
      for (;;) {
        const r = await this.risposta();
        if (r.testo.startsWith(`${tag} `)) {
          if (!r.testo.startsWith(`${tag} OK`)) throw new Error(`IMAP APPEND: ${r.testo.slice(0, 120)}`);
          return;
        }
      }
    })(), ms, 'APPEND');
  }
}

export const quota = (s: string) => `"${s.replace(/(["\\])/g, '\\$1')}"`;

// Nome della cartella della posta inviata; null se la casella non ne ha una riconoscibile
export async function cartellaInviata(imap: Imap): Promise<string | null> {
  const righe = (await imap.comando('LIST "" "*"', 15_000)).map(r => r.testo);
  const nome = (r: string) => r.match(/"([^"]+)"$/)?.[1] || r.split(' ').pop() || '';
  const riga = righe.find(r => /\\Sent\b/i.test(r)) || righe.find(r => /^(inbox[./])?(sent|inviata|posta inviata)/i.test(nome(r)));
  return riga ? nome(riga) : null;
}
