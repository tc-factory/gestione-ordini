/**
 * T&C Factory — Lavorazioni esterne
 * Ordini con lavorazione ESTERNA, divisi per tipo di lavorazione
 * (righe del modulo d'ordine con il menu "Esterna" compilato).
 * Le lavorazioni si creano in Impostazioni → Lavorazioni esterne.
 * "Completata" usa la fase lavorazioneEsterna dell'ordine, la stessa della pill "Esterna" nella lista.
 */

const EsterneState = { tab: 'todo' };
const DA_SPECIFICARE = '__nd';

function esterneGroups() {
  const orders = TCFactory.getOrders().filter(o => !o.deletedAt && !o.archived);
  const groups = new Map();   // id lavorazione → { nome, items: [{ order, rows }] }
  const add = (id, nome, order, rows) => {
    if (!groups.has(id)) groups.set(id, { id, nome, items: [] });
    groups.get(id).items.push({ order, rows });
  };

  orders.forEach(o => {
    const rows = o.orderModule?.rows || [];
    const byType = new Map();
    rows.forEach(r => {
      const id = r.esterna ? r.esterna : (r.lavEsterna ? DA_SPECIFICARE : null);
      if (!id) return;
      if (!byType.has(id)) byType.set(id, []);
      byType.get(id).push(r);
    });
    if (!byType.size && o.lavorazioneEsterna) byType.set(DA_SPECIFICARE, []);
    byType.forEach((rs, id) => add(id, id === DA_SPECIFICARE ? 'Da specificare' : (lavEsternaName(id) || 'Lavorazione eliminata'), o, rs));
  });

  // Ordine: come in Impostazioni, poi le altre, "Da specificare" in fondo
  const order = getLavEsterne().map(l => l.id);
  const rank = (g) => g.id === DA_SPECIFICARE ? 1e6 : (order.indexOf(g.id) + 1 || 1e5);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.nome.localeCompare(b.nome, 'it'));
}

const esterneDone = (o) => !!o.stages?.lavorazioneEsterna?.done;

function renderEsternePage() {
  const root = document.getElementById('esterne-root');
  if (!root) return;
  const today = localISODate(new Date());
  const fmt = (d) => TCFactory.formatDate(d, { day: '2-digit', month: '2-digit' });
  const done = EsterneState.tab === 'done';

  const all = esterneGroups();
  const count = (g, d) => g.items.filter(x => esterneDone(x.order) === d).length;
  const totTodo = new Set(all.flatMap(g => g.items.filter(x => !esterneDone(x.order)).map(x => x.order.id))).size;
  const totDone = new Set(all.flatMap(g => g.items.filter(x => esterneDone(x.order)).map(x => x.order.id))).size;

  const rowsText = (rows) => rows.map(r => [
    r.qnt ? `${r.qnt}×` : '', r.descrizione || r.codice || r.catalogo || '', r.colore || '', r.tg || '',
  ].filter(Boolean).join(' ')).filter(Boolean);

  const item = ({ order: o, rows }) => {
    const dl = TCFactory.getEffectiveDeadline(o);
    const client = TCFactory.getClient(o.clientId);
    const st = o.stages?.lavorazioneEsterna;
    const lines = rowsText(rows);
    return `
      <li class="dtf-item est-item ${isUrgentOrder(o) ? 'dtf-urgent' : ''}">
        <div class="dtf-when ${!done && dl && dl.date < today ? 'late' : ''}" title="Scadenza">
          <strong>${dl ? fmt(dl.date) : '—'}</strong>
          <span>${dl ? new Date(dl.date + 'T00:00:00').toLocaleDateString('it-IT', { weekday: 'short' }) : ''}</span>
        </div>
        <button type="button" class="dtf-main" onclick="openOrderDetail('${o.id}')">
          <strong>${escapeHtml(o.nome)}${isUrgentOrder(o) ? ' <em class="est-urgent">Urgente</em>' : ''}</strong>
          <span>${[orderDesc(o) ? escapeHtml(orderDesc(o)) : '', client && TCFactory.clientName(client) !== o.nome ? escapeHtml(TCFactory.clientName(client)) : '', o.tags.map(escapeHtml).join(', ')].filter(Boolean).join(' · ') || '&nbsp;'}</span>
        </button>
        <div class="est-rows" title="${escapeHtml(lines.join('\n'))}">
          ${lines.length ? lines.slice(0, 2).map(l => `<span>${escapeHtml(l)}</span>`).join('') + (lines.length > 2 ? `<small>+${lines.length - 2} righe</small>` : '')
            : '<small>Nessuna riga nel modulo</small>'}
        </div>
        ${done
          ? `<span class="est-done-date">${st?.date ? 'Completata ' + fmt(st.date) : 'Completata'}</span>
             <button type="button" class="btn btn-ghost btn-sm" onclick="esterneToggle('${o.id}', false)">Riapri</button>`
          : `<button type="button" class="btn btn-sm dtf-done-btn" onclick="esterneToggle('${o.id}', true)">${Icons.checkCircle('currentColor', 15)} Completata</button>`}
      </li>`;
  };

  const groups = all.map(g => ({ ...g, items: g.items.filter(x => esterneDone(x.order) === done) }))
    .filter(g => g.items.length)
    .map(g => ({ ...g, items: g.items.sort((a, b) => {
      const da = TCFactory.getEffectiveDeadline(a.order)?.date || '9999', db = TCFactory.getEffectiveDeadline(b.order)?.date || '9999';
      return (isUrgentOrder(b.order) - isUrgentOrder(a.order)) || da.localeCompare(db);
    }) }));

  const noTypes = !getLavEsterne().length;
  root.innerHTML = `
    <div class="glass-card page-card dtf-box">
      <div class="est-bar">
        <div class="segmented" role="tablist" aria-label="Stato">
          <button role="tab" type="button" aria-selected="${!done}" class="${!done ? 'active' : ''}" onclick="esterneTab('todo')">Da fare · ${totTodo}</button>
          <button role="tab" type="button" aria-selected="${done}" class="${done ? 'active' : ''}" onclick="esterneTab('done')">Completate · ${totDone}</button>
        </div>
      </div>
      ${noTypes ? `<p class="est-hint">Non ci sono ancora tipi di lavorazione: creali in
        <a href="#/impostazioni" onclick="event.preventDefault();Nav.go('impostazioni')">Impostazioni → Lavorazioni esterne</a>,
        poi sceglili nel modulo d'ordine (colonna ESTERNA).</p>` : ''}
      ${all.length > 1 ? `<nav class="est-jump" aria-label="Vai alla lavorazione">${all.map(g => {
        const n = count(g, done);
        return `<a href="#est-${escapeHtml(g.id)}" class="chip ${n ? '' : 'est-empty'}" onclick="event.preventDefault();document.getElementById('est-${escapeHtml(g.id)}')?.scrollIntoView({behavior:'smooth',block:'start'})">${escapeHtml(g.nome)} · ${n}</a>`;
      }).join('')}</nav>` : ''}
    </div>
    ${groups.length ? groups.map(g => `
      <section class="glass-card page-card dtf-box est-group" id="est-${escapeHtml(g.id)}" aria-labelledby="est-h-${escapeHtml(g.id)}">
        <div class="dtf-box-head">
          <div><h2 id="est-h-${escapeHtml(g.id)}">${escapeHtml(g.nome)}</h2>
            <p>${g.items.length} ${g.items.length === 1 ? 'ordine' : 'ordini'}${g.id === DA_SPECIFICARE ? ' · scegli la lavorazione nel modulo d\'ordine' : ''}</p></div>
        </div>
        <ol class="dtf-timeline">${g.items.map(item).join('')}</ol>
      </section>`).join('')
    : `<div class="glass-card page-card dtf-box"><div class="empty-list">${done ? 'Nessuna lavorazione esterna completata' : 'Nessuna lavorazione esterna da fare'}</div></div>`}`;
}

function esterneTab(tab) { EsterneState.tab = tab; renderEsternePage(); }

async function esterneToggle(orderId, done) {
  await toggleStageInline(orderId, 'lavorazioneEsterna', done);
  renderEsternePage();
}

window.renderEsternePage = renderEsternePage;
