/**
 * T&C Factory — Data Store v5.0
 * Ordini + Priorità + Tag, tutti sincronizzati in tempo reale su Supabase.
 */

// LAVORAZIONE (avanzamento produzione)
const LAVORAZIONE_DEFS = [
  { id: 'merceCompleta',  label: 'Merce completa', shortLabel: 'Merce' },
  { id: 'dtfPronti',      label: 'DTF pronti',      shortLabel: 'DTF' },
  { id: 'ordineStampato', label: 'Stampato',         shortLabel: 'Stampato' },
];

// EVASIONE (spedizione)
const EVASIONE_DEFS = [
  { id: 'speditoParzialmente', label: 'Spedito parzialmente', shortLabel: 'Parziale' },
  { id: 'spedito',             label: 'Evaso',                shortLabel: 'Evaso' },
];

// Compatibilità con vecchio codice
const STAGE_DEFS = [...LAVORAZIONE_DEFS, ...EVASIONE_DEFS];

const TCFactory = {

  _orders: [],
  _priorities: [],
  _tags: [],
  _listeners: [],
  _channel: null,
  _isOnline: false,

  // ─────────────────────────────────────────────
  // INIT & REALTIME
  // ─────────────────────────────────────────────

  async init() {
    try {
      const [ordersRes, prioritiesRes, tagsRes] = await Promise.all([
        supabaseClient.from('orders').select('*').order('data_ordine', { ascending: true }),
        supabaseClient.from('priorities').select('*').order('sort_order', { ascending: true }),
        supabaseClient.from('tags').select('*'),
      ]);

      if (ordersRes.error) throw ordersRes.error;
      if (prioritiesRes.error) throw prioritiesRes.error;
      if (tagsRes.error) throw tagsRes.error;

      this._orders = (ordersRes.data || []).map(this._fromDb);
      this._priorities = prioritiesRes.data || [];
      this._tags = tagsRes.data || [];

      this._isOnline = true;
      this._updateStatusBadge(true);
      this._subscribeRealtime();
      return true;
    } catch (e) {
      console.error('[TCFactory] Errore connessione a Supabase:', e.message);
      this._isOnline = false;
      this._updateStatusBadge(false);
      return false;
    }
  },

  _subscribeRealtime() {
    if (this._channel) { try { supabaseClient.removeChannel(this._channel); } catch {} }

    this._channel = supabaseClient
      .channel('gestionale-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' },     (p) => this._handleRealtimeOrders(p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'priorities' }, (p) => this._handleRealtimeSimple(p, '_priorities', 'id'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tags' },       (p) => this._handleRealtimeSimple(p, '_tags', 'name'))
      .subscribe((status) => {
        this._isOnline = (status === 'SUBSCRIBED');
        this._updateStatusBadge(this._isOnline);
      });
  },

  _handleRealtimeOrders(payload) {
    if (payload.eventType === 'INSERT') {
      const o = this._fromDb(payload.new);
      if (!this._orders.find(x => x.id === o.id)) this._orders.push(o);
    } else if (payload.eventType === 'UPDATE') {
      const o = this._fromDb(payload.new);
      const idx = this._orders.findIndex(x => x.id === o.id);
      if (idx >= 0) this._orders[idx] = o; else this._orders.push(o);
    } else if (payload.eventType === 'DELETE') {
      this._orders = this._orders.filter(x => x.id !== payload.old.id);
    }
    this._notify();
  },

  _handleRealtimeSimple(payload, listKey, idField) {
    const list = this[listKey];
    if (payload.eventType === 'INSERT') {
      if (!list.find(x => x[idField] === payload.new[idField])) list.push(payload.new);
    } else if (payload.eventType === 'UPDATE') {
      const idx = list.findIndex(x => x[idField] === payload.new[idField]);
      if (idx >= 0) list[idx] = payload.new; else list.push(payload.new);
    } else if (payload.eventType === 'DELETE') {
      this[listKey] = list.filter(x => x[idField] !== payload.old[idField]);
    }
    this._notify();
  },

  onUpdate(fn) { this._listeners.push(fn); },
  _notify() { this._listeners.forEach(fn => { try { fn(); } catch {} }); },

  _updateStatusBadge(online) {
    const badge = document.getElementById('connection-badge');
    if (!badge) return;
    badge.textContent = online ? '🟢 Online' : '🔴 Offline';
    badge.title = online ? 'Connesso a Supabase — sync in tempo reale' : 'Connessione a Supabase non disponibile';
  },

  // ─────────────────────────────────────────────
  // MAPPING DB ↔ APP
  // ─────────────────────────────────────────────

  _fromDb(row) {
    return {
      id: row.id,
      nome: row.nome,
      dataOrdine: row.data_ordine,
      deadline: row.deadline || null,
      notes: row.notes || '',
      priorityId: row.priority_id,
      tags: row.tags || [],
      files: row.files || [],
      invoiceFiles: row.invoice_files || [],
      paymentDone: !!row.payment_done,
      paymentDate: row.payment_date || null,
      invoiceConfirmed: !!row.invoice_confirmed,
      importo: parseFloat(row.importo) || 0,
      orderModule: row.order_module || { rows: [], acconto: '' },
      dtfItems: row.dtf_items || [],
      stages: row.stages || { merceCompleta: { done: false }, dtfPronti: { done: false }, ordineStampato: { done: false } },
      archived: row.archived,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  },

  _toDb(order) {
    return {
      id: order.id,
      nome: order.nome,
      data_ordine: order.dataOrdine,
      deadline: order.deadline || null,
      notes: order.notes || '',
      priority_id: order.priorityId,
      tags: order.tags || [],
      files: order.files || [],
      invoice_files: order.invoiceFiles || [],
      payment_done: !!order.paymentDone,
      payment_date: order.paymentDate || null,
      invoice_confirmed: !!order.invoiceConfirmed,
      importo: parseFloat(order.importo) || 0,
      order_module: order.orderModule || { rows: [], acconto: '' },
      dtf_items: order.dtfItems || [],
      stages: order.stages,
      archived: !!order.archived,
    };
  },

  // ─────────────────────────────────────────────
  // ALLEGATI (Supabase Storage)
  // ─────────────────────────────────────────────

  MAX_FILE_BYTES: 2 * 1024 * 1024,

  async uploadFile(file) {
    if (file.size > this.MAX_FILE_BYTES) {
      throw new Error(`${file.name} supera 2MB`);
    }
    const safeName = Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '-' + file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const { error } = await supabaseClient.storage.from('allegati').upload(safeName, file);
    if (error) throw error;
    const { data } = supabaseClient.storage.from('allegati').getPublicUrl(safeName);
    return { name: file.name, type: file.type, size: file.size, url: data.publicUrl };
  },

  // ─────────────────────────────────────────────
  // ORDINI
  // ─────────────────────────────────────────────

  getOrders() { return this._orders || []; },
  getOrderById(id) { return this._orders.find(o => o.id === id) || null; },

  // Attivi: non archiviati e non spediti parzialmente
  // Attivi: non archiviati e non ancora stampati
  getActiveOrders()         { return this.getOrders().filter(o => !o.archived && !o.stages?.ordineStampato?.done); },
  // Evasione: stampati ma non ancora evasi
  getEvasioneOrders()       { return this.getOrders().filter(o => !o.archived && !!o.stages?.ordineStampato?.done && !o.stages?.spedito?.done); },
  // Compat (non più usato come tab)
  getPartialOrders()        { return this.getOrders().filter(o => !o.archived && o.stages?.speditoParzialmente?.done && !o.stages?.spedito?.done); },
  // Da riscuotere: evasi (spedito.done) ma non ancora pagati
  getDaRiscuotereOrders()   { return this.getOrders().filter(o => !o.archived && !!o.stages?.spedito?.done); },
  // Archivio: solo quando ENTRAMBI evaso E pagato
  getArchivedOrders()       { return this.getOrders().filter(o => o.archived); },

  generateId() {
    const nums = this._orders.map(o => parseInt((o.id || '').replace('ORD-', '')) || 0);
    const next = Math.max(0, ...nums) + 1;
    return 'ORD-' + String(next).padStart(4, '0');
  },

  emptyStages() {
    return {
      merceCompleta:       { done: false },
      dtfPronti:           { done: false },
      ordineStampato:      { done: false },
      speditoParzialmente: { done: false },
      spedito:             { done: false },
    };
  },

  async addOrder(data) {
    const order = {
      id: this.generateId(),
      nome: data.nome,
      dataOrdine: data.dataOrdine,
      deadline: data.deadline || null,
      notes: data.notes || '',
      priorityId: data.priorityId,
      tags: data.tags || [],
      files: data.files || [],
      invoiceFiles: data.invoiceFiles || [],
      paymentDone: false,
      paymentDate: null,
      invoiceConfirmed: false,
      importo: parseFloat(data.importo) || 0,
      orderModule: data.orderModule || { rows: [], acconto: '' },
      dtfItems: [],
      stages: this.emptyStages(),
      archived: false,
    };
    let { data: row, error } = await supabaseClient.from('orders').insert(this._toDb(order)).select().single();
    if (error && error.message) {
      const payload = this._toDb(order);
      // Rimuovi TUTTE le colonne opzionali in un colpo solo
      ['dtf_items','invoice_files','payment_done','payment_date','invoice_confirmed','importo','order_module'].forEach(col => delete payload[col]);
      ({ data: row, error } = await supabaseClient.from('orders').insert(payload).select().single());
    }
    if (error) throw error;
    const created = this._fromDb(row);
    this._log('Ordine creato', created.id, created.nome, { priorityId: created.priorityId, deadline: created.deadline });
    return created;
  },

  async updateOrder(id, patch) {
    const current = this.getOrderById(id);
    if (!current) throw new Error('Ordine non trovato');
    const merged = { ...current, ...patch };
    let { data: row, error } = await supabaseClient.from('orders').update(this._toDb(merged)).eq('id', id).select().single();
    if (error && error.message) {
      const payload = this._toDb(merged);
      // Rimuovi TUTTE le colonne opzionali in un colpo solo
      ['dtf_items','invoice_files','payment_done','payment_date','invoice_confirmed','importo','order_module'].forEach(col => delete payload[col]);
      ({ data: row, error } = await supabaseClient.from('orders').update(payload).eq('id', id).select().single());
    }
    if (error) throw error;
    return this._fromDb(row);
  },

  async setStage(id, stageId, done) {
    const current = this.getOrderById(id);
    if (!current) return;
    const today = new Date().toISOString().slice(0, 10);
    const stages = { ...current.stages, [stageId]: done ? { done: true, date: today } : { done: false } };
    const updated = await this.updateOrder(id, { stages });
    const stageLbl = [...LAVORAZIONE_DEFS, ...EVASIONE_DEFS].find(s => s.id === stageId)?.label || stageId;
    this._log(done ? `✓ ${stageLbl}` : `☐ ${stageLbl}`, id, current.nome, { stage: stageId, done });
    return updated;
  },

  async setArchived(id, archived) {
    const current = this.getOrderById(id);
    const updated = await this.updateOrder(id, { archived });
    this._log(archived ? 'Archiviato' : 'Ripristinato', id, current?.nome || id);
    return updated;
  },

  async deleteOrder(id) {
    const current = this.getOrderById(id);
    const { error } = await supabaseClient.from('orders').delete().eq('id', id);
    if (error) throw error;
    this._log('Ordine eliminato', id, current?.nome || id);
  },

  // ── Registro attività ──────────────────────────
  async _log(action, orderId, orderName, details = {}) {
    try {
      const nick = window.TCAuth?.getNickname() || 'sistema';
      await supabaseClient.from('activity_log').insert({
        user_nickname: nick,
        action,
        order_id:   orderId   || null,
        order_name: orderName || null,
        details,
      });
    } catch(e) { /* non bloccare le operazioni se il log fallisce */ }
  },

  async getActivityLog({ filterUser = '', searchQuery = '', offset = 0, pageSize = 100 } = {}) {
    let query = supabaseClient
      .from('activity_log')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });
    if (filterUser)   query = query.eq('user_nickname', filterUser);
    if (searchQuery)  query = query.or(`action.ilike.%${searchQuery}%,order_name.ilike.%${searchQuery}%`);
    query = query.range(offset, offset + pageSize - 1);
    const { data, error, count } = await query;
    if (error) throw error;
    return { entries: data || [], total: count || 0 };
  },

  async getLogUsers() {
    const { data, error } = await supabaseClient
      .from('activity_log')
      .select('user_nickname')
      .order('user_nickname');
    if (error) return [];
    const unique = [...new Set((data||[]).map(r => r.user_nickname))];
    return unique;
  },

  // ─────────────────────────────────────────────
  // PRIORITÀ
  // ─────────────────────────────────────────────

  getPriorities() { return [...this._priorities].sort((a, b) => a.sort_order - b.sort_order); },
  getPriority(id) { return this._priorities.find(p => p.id === id); },

  getPriorityRank(id) {
    const p = this.getPriority(id);
    return p ? p.sort_order : 999;
  },

  async addPriority(label, color) {
    const trimmed = label.trim();
    if (!trimmed) return;
    const id = trimmed.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Math.random().toString(36).slice(2, 6);
    const sortOrder = this._priorities.length;
    const { error } = await supabaseClient.from('priorities').insert({ id, label: trimmed, color, sort_order: sortOrder });
    if (error) throw error;
  },

  async updatePriority(id, patch) {
    const { error } = await supabaseClient.from('priorities').update(patch).eq('id', id);
    if (error) throw error;
  },

  async deletePriority(id) {
    if (this._priorities.length <= 1) return;
    const { error } = await supabaseClient.from('priorities').delete().eq('id', id);
    if (error) throw error;
  },

  async reorderPriority(id, direction) {
    const sorted = this.getPriorities();
    const idx = sorted.findIndex(p => p.id === id);
    if (idx < 0) return;
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= sorted.length) return;
    [sorted[idx], sorted[target]] = [sorted[target], sorted[idx]];

    const updates = sorted.map((p, i) =>
      supabaseClient.from('priorities').update({ sort_order: i }).eq('id', p.id)
    );
    await Promise.all(updates);
  },

  // ─────────────────────────────────────────────
  // TAG
  // ─────────────────────────────────────────────

  getTags() { return this._tags; },
  getTagColor(name) { return this._tags.find(t => t.name === name)?.color || '#64748b'; },

  async addTag(name, color) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (this._tags.some(t => t.name === trimmed)) return;
    const palette = ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#6366f1'];
    const finalColor = color || palette[this._tags.length % palette.length];
    const { error } = await supabaseClient.from('tags').insert({ name: trimmed, color: finalColor });
    if (error) throw error;
  },

  async updateTagColor(name, color) {
    const { error } = await supabaseClient.from('tags').update({ color }).eq('name', name);
    if (error) throw error;
  },

  async deleteTag(name) {
    const { error } = await supabaseClient.from('tags').delete().eq('name', name);
    if (error) throw error;
    // Rimuovi il tag da tutti gli ordini che lo usano
    const affected = this._orders.filter(o => o.tags.includes(name));
    for (const o of affected) {
      await this.updateOrder(o.id, { tags: o.tags.filter(t => t !== name) });
    }
  },

  // ─────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────

  stageProgress(order) {
    const stages = order.stages || {};
    const lavDone  = LAVORAZIONE_DEFS.filter(s => stages[s.id]?.done).length;
    const lavTotal = LAVORAZIONE_DEFS.length;
    const evaDone  = EVASIONE_DEFS.filter(s => stages[s.id]?.done).length;
    const evaTotal = EVASIONE_DEFS.length;
    return {
      lavDone,
      lavTotal,
      evaDone,
      evaTotal,
      allLavDone:   lavDone === lavTotal,
      isSpeditoP:   !!stages.speditoParzialmente?.done,
      isSpedito:    !!stages.spedito?.done,
      // compat
      done: lavDone,
      total: lavTotal,
      allDone: lavDone === lavTotal,
    };
  },

  isCompleted(order) { return this.stageProgress(order).allLavDone; },

  isDeadlinePast(order) {
    if (!order.deadline) return false;
    const today = new Date().toISOString().slice(0, 10);
    return order.deadline < today;
  },

  // ─────────────────────────────────────────────
  // DTF CALCULATIONS
  // ─────────────────────────────────────────────

  DTF_ROLL_WIDTH: 57,   // cm
  DTF_SPEED: 8,         // m/ora

  calcDTFItem(item) {
    const w   = parseFloat(item.width_cm)  || 0;
    const h   = parseFloat(item.height_cm) || 0;
    const qty = parseInt(item.qty)         || 1;
    if (w <= 0 || h <= 0) return { meters: 0, hours: 0, minutes: 0 };
    const filesPerRow  = Math.max(1, Math.floor(this.DTF_ROLL_WIDTH / w));
    const rows         = Math.ceil(qty / filesPerRow);
    const meters       = parseFloat(((rows * h) / 100).toFixed(2));
    const totalHours   = meters / this.DTF_SPEED;
    const hours        = Math.floor(totalHours);
    const minutes      = Math.round((totalHours - hours) * 60);
    return { meters, hours, minutes };
  },

  calcDTFTotal(dtfItems) {
    const totalMeters = dtfItems.reduce((s, i) => s + this.calcDTFItem(i).meters, 0);
    const rounded     = parseFloat(totalMeters.toFixed(2));
    const totalH      = rounded / this.DTF_SPEED;
    return {
      meters:  rounded,
      hours:   Math.floor(totalH),
      minutes: Math.round((totalH - Math.floor(totalH)) * 60),
    };
  },

  // ─────────────────────────────────────────────
  // PLANNER DTF  (localStorage — operativo, non sincronizzato)
  //
  // Formato schedule: { 'YYYY-MM-DD': [{id, meters},...] }
  // meters=null  → usa i metri totali dell'ordine
  // meters=N     → quota parziale (split automatico)
  // ─────────────────────────────────────────────

  PLAN_KEY:       'tcf_dtf_plan',
  CAPACITY_KEY:   'tcf_dtf_capacity',
  STANDALONE_KEY: 'tcf_dtf_standalone',

  getPlannerCapacity() {
    return parseFloat(localStorage.getItem(this.CAPACITY_KEY) || '60');
  },
  setPlannerCapacity(v) {
    localStorage.setItem(this.CAPACITY_KEY, String(Math.max(1, parseFloat(v) || 60)));
  },

  // ── Schedule ──────────────────────────────────
  getSchedule() {
    try { return JSON.parse(localStorage.getItem(this.PLAN_KEY) || '{}'); } catch { return {}; }
  },

  // Restituisce [{id, meters}] normalizzato (gestisce anche il vecchio formato stringhe)
  getDayScheduleEntries(dateStr) {
    const raw = (this.getSchedule()[dateStr] || []);
    return raw.map(e => typeof e === 'string' ? { id: e, meters: null } : e);
  },

  setDayScheduleEntries(dateStr, entries) {
    const s = this.getSchedule();
    s[dateStr] = entries;
    localStorage.setItem(this.PLAN_KEY, JSON.stringify(s));
  },

  scheduleOrder(orderId, dateStr) {
    const s = this.getSchedule();
    // Rimuovi da qualsiasi giorno (anche split)
    Object.keys(s).forEach(d => {
      s[d] = (s[d] || []).filter(e => (typeof e === 'string' ? e : e.id) !== orderId);
    });
    if (!s[dateStr]) s[dateStr] = [];
    s[dateStr].push({ id: orderId, meters: null }); // meters=null = ordine intero
    localStorage.setItem(this.PLAN_KEY, JSON.stringify(s));
  },

  unscheduleOrder(orderId) {
    const s = this.getSchedule();
    Object.keys(s).forEach(d => {
      s[d] = (s[d] || []).filter(e => (typeof e === 'string' ? e : e.id) !== orderId);
    });
    localStorage.setItem(this.PLAN_KEY, JSON.stringify(s));
  },

  isScheduledAnywhere(id) {
    return Object.values(this.getSchedule()).some(entries =>
      (entries || []).some(e => (typeof e === 'string' ? e : e.id) === id)
    );
  },

  // Risolve i metri effettivi di una entry (null = totale)
  _entryMeters(entry, sourceMap) {
    const id = typeof entry === 'string' ? entry : entry.id;
    const allocated = typeof entry === 'object' && entry.meters != null ? entry.meters : null;
    if (allocated !== null) return allocated;
    const src = sourceMap ? sourceMap[id] : this.getAllDTFSources().find(s => s.id === id);
    return src ? this.calcDTFTotal(src.dtfItems || []).meters : 0;
  },

  _nextDay(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  },

  // ── Auto-scheduling ───────────────────────────
  // Pianifica automaticamente le sorgenti non ancora schedulate:
  // - ordina per deadline → priorità → merce completa
  // - riempie i giorni dal giorno corrente
  // - se un ordine scavalla la capacità giornaliera, lo divide tra i due giorni
  // - non sposta mai elementi già schedulati manualmente
  autoSchedule() {
    const capacity   = this.getPlannerCapacity();
    const allSources = this.getAllDTFSources();
    const sourceMap  = Object.fromEntries(allSources.map(s => [s.id, s]));
    const schedule   = this.getSchedule();
    const today      = new Date().toISOString().slice(0, 10);

    // Calcola utilizzo giornaliero esistente
    const dayUsage = {};
    Object.entries(schedule).forEach(([date, entries]) => {
      dayUsage[date] = (entries || []).reduce((sum, e) => sum + this._entryMeters(e, sourceMap), 0);
    });

    // Sorgenti non ancora schedulate e con metri > 0
    const unscheduled = allSources.filter(s => {
      const m = this.calcDTFTotal(s.dtfItems || []).meters;
      return m > 0 && !this.isScheduledAnywhere(s.id);
    });

    // Ordinamento: deadline ASC → priorityRank ASC → merceCompleta (done=0, not=1)
    unscheduled.sort((a, b) => {
      const da = a.deadline || '9999-12-31';
      const db = b.deadline || '9999-12-31';
      if (da !== db) return da.localeCompare(db);
      const pa = a.priorityRank ?? 999;
      const pb = b.priorityRank ?? 999;
      if (pa !== pb) return pa - pb;
      return (a.merceCompleta ? 0 : 1) - (b.merceCompleta ? 0 : 1);
    });

    // Piazza ogni sorgente, con split automatico se necessario
    unscheduled.forEach(source => {
      let remaining    = this.calcDTFTotal(source.dtfItems || []).meters;
      const totalM     = remaining;
      if (remaining <= 0) return;

      let day = today;
      let iterations = 0;

      while (remaining > 0 && iterations < 365) {
        iterations++;
        const used      = dayUsage[day] || 0;
        const available = Math.max(0, capacity - used);

        if (available <= 0) { day = this._nextDay(day); continue; }

        const toPlace   = parseFloat(Math.min(remaining, available).toFixed(2));
        const isPartial = toPlace < totalM || remaining < totalM; // split in corso

        if (!schedule[day]) schedule[day] = [];
        schedule[day].push({ id: source.id, meters: isPartial ? toPlace : null });

        dayUsage[day] = (dayUsage[day] || 0) + toPlace;
        remaining     = parseFloat((remaining - toPlace).toFixed(2));

        if (remaining > 0) day = this._nextDay(day);
      }
    });

    localStorage.setItem(this.PLAN_KEY, JSON.stringify(schedule));
  },

  // ── Priorità default ─────────────────────────
  getDefaultPriorityId() {
    const normal = this._priorities.find(p =>
      p.id === 'normale' || p.label.toLowerCase() === 'normale' || p.label.toLowerCase() === 'normal'
    );
    return normal?.id || this._priorities[this._priorities.length - 1]?.id || null;
  },

  // ── Voci standalone (conto terzi, senza ordine reale) ──
  getStandalone() {
    try { return JSON.parse(localStorage.getItem(this.STANDALONE_KEY) || '[]'); } catch { return []; }
  },
  addStandalone(label, dtfItems, priorityId) {
    const items = this.getStandalone();
    const id    = 'STD-' + Date.now();
    items.push({ id, label: label.trim(), dtfItems: dtfItems || [], priorityId: priorityId || null });
    localStorage.setItem(this.STANDALONE_KEY, JSON.stringify(items));
    return id;
  },
  updateStandalone(id, label, dtfItems, priorityId) {
    const items = this.getStandalone().map(s =>
      s.id === id ? { ...s, label: label.trim(), dtfItems: dtfItems || [], priorityId: priorityId || null } : s
    );
    localStorage.setItem(this.STANDALONE_KEY, JSON.stringify(items));
  },
  removeStandalone(id) {
    const items = this.getStandalone().filter(s => s.id !== id);
    localStorage.setItem(this.STANDALONE_KEY, JSON.stringify(items));
    this.unscheduleOrder(id);
  },
  getStandaloneById(id) {
    return this.getStandalone().find(s => s.id === id) || null;
  },

  // ── Tutte le sorgenti DTF (ordini reali + standalone) ──
  // Includiamo priorityRank e merceCompleta per l'ordinamento auto-schedule
  getAllDTFSources() {
    const orders = this.getOrdersWithDTF().map(o => ({
      id: o.id,
      label: o.nome,
      deadline: o.deadline || null,
      dtfItems: o.dtfItems,
      isStandalone: false,
      color: this.getPriority(o.priorityId)?.color || '#6366f1',
      priorityRank: this.getPriorityRank(o.priorityId),
      priorityId: o.priorityId,
      merceCompleta: o.stages?.merceCompleta?.done || false,
    }));
    const standalone = this.getStandalone().map(s => {
      const pri = s.priorityId ? this.getPriority(s.priorityId) : null;
      return {
        id: s.id,
        label: s.label,
        deadline: null,
        dtfItems: s.dtfItems,
        isStandalone: true,
        color: pri?.color || '#94a3b8',
        priorityRank: s.priorityId ? this.getPriorityRank(s.priorityId) : 999,
        priorityId: s.priorityId || null,
        merceCompleta: false,
      };
    });
    return [...orders, ...standalone];
  },

  getOrdersWithDTF() {
    return this.getOrders().filter(o => o.dtfItems && o.dtfItems.length > 0 && !o.archived);
  },

  formatDate(dateStr, opts) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('it-IT', opts || { day: '2-digit', month: 'short', year: 'numeric' });
  },

  getDefaultDate() {
    return new Date().toISOString().slice(0, 10);
  },
};

window.TCFactory = TCFactory;
window.STAGE_DEFS = STAGE_DEFS;
