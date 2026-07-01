/**
 * T&C Factory — Data Store v5.0
 * Ordini + Priorità + Tag, tutti sincronizzati in tempo reale su Supabase.
 * Allegati su Supabase Storage (bucket "allegati").
 */

const STAGE_DEFS = [
  { id: 'merceCompleta',   label: 'Merce completa' },
  { id: 'dtfPronti',       label: 'DTF pronti' },
  { id: 'ordineStampato',  label: 'Ordine stampato' },
];

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
  getActiveOrders()   { return this.getOrders().filter(o => !o.archived); },
  getArchivedOrders() { return this.getOrders().filter(o => o.archived); },

  generateId() {
    const nums = this._orders.map(o => parseInt((o.id || '').replace('ORD-', '')) || 0);
    const next = Math.max(0, ...nums) + 1;
    return 'ORD-' + String(next).padStart(4, '0');
  },

  emptyStages() {
    return {
      merceCompleta:  { done: false },
      dtfPronti:      { done: false },
      ordineStampato: { done: false },
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
      dtfItems: data.dtfItems || [],
      stages: this.emptyStages(),
      archived: false,
    };
    let { data: row, error } = await supabaseClient.from('orders').insert(this._toDb(order)).select().single();
    if (error && error.message && error.message.includes('dtf_items')) {
      // Colonna dtf_items non ancora creata — salva senza di essa
      const payload = this._toDb(order);
      delete payload.dtf_items;
      ({ data: row, error } = await supabaseClient.from('orders').insert(payload).select().single());
    }
    if (error) throw error;
    return this._fromDb(row);
  },

  async updateOrder(id, patch) {
    const current = this.getOrderById(id);
    if (!current) throw new Error('Ordine non trovato');
    const merged = { ...current, ...patch };
    let { data: row, error } = await supabaseClient.from('orders').update(this._toDb(merged)).eq('id', id).select().single();
    if (error && error.message && error.message.includes('dtf_items')) {
      // Colonna dtf_items non ancora creata — aggiorna senza di essa
      const payload = this._toDb(merged);
      delete payload.dtf_items;
      ({ data: row, error } = await supabaseClient.from('orders').update(payload).eq('id', id).select().single());
    }
    if (error) throw error;
    return this._fromDb(row);
  },

  async setStage(id, stageId, done) {
    const current = this.getOrderById(id);
    if (!current) return;
    const today = new Date().toISOString().slice(0, 10);
    const stages = {
      ...current.stages,
      [stageId]: done ? { done: true, date: today } : { done: false },
    };
    return this.updateOrder(id, { stages });
  },

  async setArchived(id, archived) {
    return this.updateOrder(id, { archived });
  },

  async deleteOrder(id) {
    const { error } = await supabaseClient.from('orders').delete().eq('id', id);
    if (error) throw error;
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
    const total = STAGE_DEFS.length;
    const done = STAGE_DEFS.filter(s => order.stages[s.id]?.done).length;
    const allDone = done === total;
    let lastDate = null;
    for (const s of STAGE_DEFS) {
      const d = order.stages[s.id]?.date;
      if (d && (!lastDate || d > lastDate)) lastDate = d;
    }
    return { done, total, allDone, lastDate };
  },

  isCompleted(order) { return this.stageProgress(order).allDone; },

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
  getDaySchedule(dateStr) {
    return (this.getSchedule()[dateStr] || []);
  },
  setDaySchedule(dateStr, orderedIds) {
    const s = this.getSchedule();
    s[dateStr] = orderedIds;
    localStorage.setItem(this.PLAN_KEY, JSON.stringify(s));
  },
  scheduleOrder(orderId, dateStr) {
    const s = this.getSchedule();
    // Rimuovi da qualsiasi giorno in cui è già presente
    Object.keys(s).forEach(d => { s[d] = (s[d] || []).filter(id => id !== orderId); });
    if (!s[dateStr]) s[dateStr] = [];
    if (!s[dateStr].includes(orderId)) s[dateStr].push(orderId);
    localStorage.setItem(this.PLAN_KEY, JSON.stringify(s));
  },
  unscheduleOrder(orderId) {
    const s = this.getSchedule();
    Object.keys(s).forEach(d => { s[d] = (s[d] || []).filter(id => id !== orderId); });
    localStorage.setItem(this.PLAN_KEY, JSON.stringify(s));
  },
  isScheduledAnywhere(id) {
    return Object.values(this.getSchedule()).some(ids => (ids || []).includes(id));
  },

  // ── Voci standalone (conto terzi, senza ordine reale) ──
  getStandalone() {
    try { return JSON.parse(localStorage.getItem(this.STANDALONE_KEY) || '[]'); } catch { return []; }
  },
  addStandalone(label, dtfItems) {
    const items = this.getStandalone();
    const id = 'STD-' + Date.now();
    items.push({ id, label: label.trim(), dtfItems: dtfItems || [] });
    localStorage.setItem(this.STANDALONE_KEY, JSON.stringify(items));
    return id;
  },
  updateStandalone(id, label, dtfItems) {
    const items = this.getStandalone().map(s =>
      s.id === id ? { ...s, label: label.trim(), dtfItems: dtfItems || [] } : s
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
  getAllDTFSources() {
    const orders = this.getOrdersWithDTF().map(o => ({
      id: o.id,
      label: o.nome,
      dtfItems: o.dtfItems,
      isStandalone: false,
      color: this.getPriority(o.priorityId)?.color || '#6366f1',
    }));
    const standalone = this.getStandalone().map(s => ({
      id: s.id,
      label: s.label,
      dtfItems: s.dtfItems,
      isStandalone: true,
      color: '#94a3b8',
    }));
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
