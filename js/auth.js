/**
 * T&C Factory — Auth Module
 * Login con Supabase Auth: la sessione è un token firmato gestito da Supabase,
 * il database verifica chi sei a ogni richiesta (policy RLS).
 * Nel browser non resta nessuna password.
 *
 * Gli utenti continuano a entrare con il nickname: l'email di login è
 * <nickname>@tcfactory.local e non viene mai usata per inviare posta.
 * Creazione/eliminazione utenti e reset password passano dalla funzione
 * admin-users (supabase/functions/admin-users), che verifica che chi chiama sia admin.
 */

const LOGIN_EMAIL_DOMAIN = 'tcfactory.local';
const nicknameToEmail = (nick) => `${nick.trim().toLowerCase()}@${LOGIN_EMAIL_DOMAIN}`;

const TCAuth = {
  _session: null,   // { nickname, isAdmin, canViewEconomics, authId }

  // Recupera la sessione salvata da Supabase e il profilo dell'utente
  async init() {
    localStorage.removeItem('tcf_session');   // sessione del vecchio login, con password in chiaro
    const { data } = await supabaseClient.auth.getSession();
    if (data?.session) await this._loadProfile(data.session.user);

    supabaseClient.auth.onAuthStateChange((event) => {
      // Sessione scaduta o chiusa da un'altra scheda: torna al login
      if (event === 'SIGNED_OUT' && this._session) {
        this._session = null;
        window.renderLoginScreen?.();
      }
    });
  },

  async _loadProfile(user) {
    const { data, error } = await supabaseClient
      .from('app_users')
      .select('nickname, is_admin, can_view_economics')
      .eq('auth_id', user.id)
      .maybeSingle();
    if (error || !data) { this._session = null; return null; }
    this._session = {
      nickname: data.nickname,
      isAdmin: !!data.is_admin,
      canViewEconomics: !!data.can_view_economics,
      authId: user.id,
    };
    return this._session;
  },

  // Rilegge ruolo e permessi senza rifare il login (es. dopo che l'admin cambia il flag)
  async refreshEconomicsFlag() {
    const { data } = await supabaseClient.auth.getUser();
    if (data?.user) await this._loadProfile(data.user);
  },

  getUser()            { return this._session; },
  getNickname()        { return this._session?.nickname || '?'; },
  isLoggedIn()         { return !!this._session; },
  isAdmin()            { return !!this._session?.isAdmin; },
  canViewEconomics()   { return !!this._session?.canViewEconomics || !!this._session?.isAdmin; },

  async login(nickname, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: nicknameToEmail(nickname),
      password,
    });
    if (error) {
      throw new Error(/invalid login credentials/i.test(error.message) ? 'Credenziali non valide' : 'Errore di connessione');
    }
    const profile = await this._loadProfile(data.user);
    if (!profile) {
      await supabaseClient.auth.signOut();
      throw new Error('Account non abilitato al gestionale');
    }
    return profile;
  },

  async logout() {
    this._session = null;
    await supabaseClient.auth.signOut();
  },

  // ── Gestione utenti (solo admin, via funzione admin-users) ──

  async _admin(action, payload = {}) {
    if (!this.isAdmin()) throw new Error('Non autorizzato');
    const { data, error } = await supabaseClient.functions.invoke('admin-users', { body: { action, ...payload } });
    if (error) {
      let msg = 'Errore di connessione';
      try { msg = (await error.context.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    if (!data?.success) throw new Error(data?.error || 'Errore');
    return data;
  },

  async listUsers() {
    const { data, error } = await supabaseClient
      .from('app_users')
      .select('nickname, is_admin, can_view_economics, created_at')
      .order('created_at');
    if (error) throw error;
    return data || [];
  },

  createUser(newNickname, newPassword, isAdmin = false) {
    return this._admin('create', { nickname: newNickname.trim().toLowerCase(), password: newPassword, isAdmin });
  },

  deleteUser(targetNickname) {
    return this._admin('delete', { nickname: targetNickname });
  },

  adminResetPassword(targetNickname, newPassword) {
    return this._admin('reset_password', { nickname: targetNickname, password: newPassword });
  },

  setUserEconomics(targetNickname, value) {
    return this._admin('set_economics', { nickname: targetNickname, value: !!value });
  },

  // Cambio password self-service: verifica la password attuale, poi aggiorna
  async changePassword(oldPassword, newPassword) {
    const { error: authErr } = await supabaseClient.auth.signInWithPassword({
      email: nicknameToEmail(this._session.nickname),
      password: oldPassword,
    });
    if (authErr) throw new Error('Password attuale non corretta');
    const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
    if (error) throw new Error(/should be at least/i.test(error.message) ? `Password troppo corta (min. ${MIN_PASSWORD_LENGTH} caratteri)` : 'Errore cambio password');
  },
};

// Lunghezza minima delle password nuove (le esistenti restano valide)
const MIN_PASSWORD_LENGTH = 8;

window.TCAuth = TCAuth;
