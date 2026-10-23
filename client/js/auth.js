class Auth {
  constructor() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    this.user = JSON.parse(localStorage.getItem('nexhub_user') || 'null');
  }

  isLoggedIn() {
    return !!this.user;
  }

  _set(user) {
    this.user = user || null;
    if (user) localStorage.setItem('nexhub_user', JSON.stringify(user));
    else localStorage.removeItem('nexhub_user');
  }

  async listAccounts() {
    const b = await window.nexhub.request('GET', '/auth/accounts');
    return (b.body && b.body.accounts) || [];
  }

  async createAccount(username, password) {
    const b = await window.nexhub.request('POST', '/auth/create', { username, password });
    this._check(b);
    this._set(b.body.user);
    return b.body;
  }

  async login(username, password, remember) {
    const b = await window.nexhub.request('POST', '/auth/login', { username, password, remember: !!remember });
    this._check(b);
    this._set(b.body.user);
    return b.body;
  }

  async resetPassword(username, recoveryCode, newPassword) {
    const b = await window.nexhub.request('POST', '/auth/reset', { username, recoveryCode, newPassword });
    this._check(b);
    return b.body;
  }

  async changePassword(currentPassword, newPassword) {
    const b = await window.nexhub.request('POST', '/auth/change-password', { currentPassword, newPassword });
    this._check(b);
    return b.body;
  }

  async regenerateRecovery(password) {
    const b = await window.nexhub.request('POST', '/auth/regenerate-recovery', { password });
    this._check(b);
    return b.body;
  }

  async deleteAccount(password) {
    const b = await window.nexhub.request('POST', '/auth/delete', { password });
    this._check(b);
    this.logoutLocal();
    return b.body;
  }

  async deleteAccountById(id, password) {
    const b = await window.nexhub.request('POST', '/auth/accounts/' + id + '/delete', { password });
    this._check(b);
    if (this.user && Number(this.user.id) === Number(id)) this.logoutLocal();
    return b.body;
  }

  async updateAccount(id, data) {
    const b = await window.nexhub.request('POST', '/auth/accounts/' + id + '/update', data || {});
    this._check(b);
    const user = b.body && b.body.user;
    if (user && this.user && Number(this.user.id) === Number(user.id)) this._set(user);
    return user;
  }

  async checkSession() {
    try {
      const b = await window.nexhub.request('GET', '/auth/me');
      const u = b.body && b.body.user;
      if (u) { this._set(u); return true; }
    } catch (e) {}
    this.logoutLocal();
    return false;
  }

  async logout() {
    try { await window.nexhub.request('POST', '/auth/logout'); } catch (e) {}
    this.logoutLocal();
  }

  async getSecurity() {
    const b = await window.nexhub.request('GET', '/auth/security');
    return (b.body && b.body.security) || { hasPin: false, autoLockMinutes: 0, protectDangerous: false };
  }

  async setPin(currentPassword, pin) {
    const b = await window.nexhub.request('POST', '/auth/security/pin', { currentPassword, pin });
    this._check(b);
    return b.body.security;
  }

  async removePin(password) {
    const b = await window.nexhub.request('POST', '/auth/security/pin/remove', { password });
    this._check(b);
    return b.body.security;
  }

  async unlock(pin) {
    const b = await window.nexhub.request('POST', '/auth/security/unlock', { pin });
    this._check(b);
    return b.body;
  }

  async updateSecurity(data) {
    const b = await window.nexhub.request('PUT', '/auth/security', data);
    this._check(b);
    return b.body.security;
  }

  async verifyPassword(password) {
    const b = await window.nexhub.request('POST', '/auth/verify-password', { password });
    this._check(b);
    return b.body;
  }

  async setRemember(remember) {
    const b = await window.nexhub.request('POST', '/auth/remember', { remember: !!remember });
    this._check(b);
    return b.body.remember;
  }

  async getStats() {
    const b = await window.nexhub.request('GET', '/auth/stats');
    this._check(b);
    return b.body.stats;
  }

  async resetData(password) {
    const b = await window.nexhub.request('POST', '/auth/reset-data', { password });
    this._check(b);
    return b.body;
  }

  logoutLocal() {
    this._set(null);
  }

  _check(res) {
    if (!res || res.status >= 400) throw new Error((res && res.body && res.body.error) || 'Ошибка');
  }
}

const auth = new Auth();
export default auth;
