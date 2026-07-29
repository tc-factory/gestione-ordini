/**
 * T&C Factory — Auth Module
 * Gestisce sessione, login/logout e gestione utenti.
 * La password viene verificata lato DB tramite bcrypt (pgcrypto).
 */

const TCAuth = {
  _session: null,

  init() {
    try { this._session = JSON.parse(localStorage.getItem('tcf_session') || 'null'); }
    catch { this._session = null; }
  },

  getUser()            { return this._session; },
  getNickname()        { return this._session?.nickname || '?'; },
  isLoggedIn()         { return !!this._session; },
  isAdmin()            { return !!this._session?.isAdmin; },
  canViewEconomics()   { return !!this._session?.canViewEconomics || !!this._session?.isAdmin; },

  async login(nickname, password) {
    const { data, error } = await supabaseClient.rpc('tc_login', {
      p_nickname: nickname.trim().toLowerCase(),
      p_password: password,
    });
    if (error) throw new Error('Errore di connessione');
    if (!data?.success) throw new Error(data?.error || 'Credenziali non valide');
    this._session = {
      nickname: data.nickname,
      isAdmin: !!data.is_admin,
      canViewEconomics: !!data.can_view_economics,
      _pwd: password
    };
    localStorage.setItem('tcf_session', JSON.stringify(this._session));
    return this._session;
  },

  logout() {
    this._session = null;
    localStorage.removeItem('tcf_session');
  },

  // ── User management (solo admin) ──────────────

  async listUsers() {
    const { data, error } = await supabaseClient
      .from('app_users')
      .select('nickname, is_admin, can_view_economics, created_at')
      .order('created_at');
    if (error) throw error;
    return data || [];
  },

  async createUser(newNickname, newPassword, isAdmin = false) {
    this._requireAdminPwd();
    const { data, error } = await supabaseClient.rpc('tc_manage_user', {
      p_admin_nick: this._session.nickname,
      p_admin_pwd:  this._session._pwd,
      p_action:     'create',
      p_target_nick: newNickname.trim().toLowerCase(),
      p_target_pwd:  newPassword,
      p_is_admin:    isAdmin,
    });
    if (error || !data?.success) throw new Error(data?.error || 'Errore creazione utente');
  },

  async deleteUser(targetNickname) {
    this._requireAdminPwd();
    const { data, error } = await supabaseClient.rpc('tc_manage_user', {
      p_admin_nick: this._session.nickname,
      p_admin_pwd:  this._session._pwd,
      p_action:     'delete',
      p_target_nick: targetNickname,
      p_target_pwd:  '',
      p_is_admin:    false,
    });
    if (error || !data?.success) throw new Error(data?.error || 'Errore eliminazione');
  },

  // Cambio password self-service
  async changePassword(oldPassword, newPassword) {
    const { data, error } = await supabaseClient.rpc('tc_change_password', {
      p_nickname:     this._session.nickname,
      p_old_password: oldPassword,
      p_new_password: newPassword,
    });
    if (error || !data?.success) throw new Error(data?.error || 'Errore cambio password');
    // Aggiorna la password in sessione (serve per le operazioni admin)
    this._session._pwd = newPassword;
    localStorage.setItem('tcf_session', JSON.stringify(this._session));
  },

  // Reset password da admin (senza conoscere la vecchia)
  async adminResetPassword(targetNickname, newPassword) {
    this._requireAdminPwd();
    const { data, error } = await supabaseClient.rpc('tc_admin_reset_password', {
      p_admin_nick:  this._session.nickname,
      p_admin_pwd:   this._session._pwd,
      p_target_nick: targetNickname,
      p_new_pwd:     newPassword,
    });
    if (error || !data?.success) throw new Error(data?.error || 'Errore reset password');
  },

  _requireAdminPwd() {
    if (!this._session?.isAdmin) throw new Error('Non autorizzato');
    if (!this._session?._pwd) throw new Error('Sessione scaduta — effettua di nuovo il login');
  },

  async setUserEconomics(targetNickname, value) {
    this._requireAdminPwd();
    const { data, error } = await supabaseClient.rpc('tc_set_user_economics', {
      p_admin_nick:  this._session.nickname,
      p_admin_pwd:   this._session._pwd,
      p_target_nick: targetNickname,
      p_value:       value,
    });
    if (error || !data?.success) throw new Error(data?.error || 'Errore');
  },
};

window.TCAuth = TCAuth;
