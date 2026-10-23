const { createRouter } = require('../router');
const session = require('../session');

const router = createRouter();

function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      const code = e.code;
      if (code === 'AUTH') return res.status(401).json({ error: e.message });
      if (code === 'DENIED') return res.status(400).json({ error: e.message });
      if (code === 'CONFLICT') return res.status(409).json({ error: e.message });
      if (code === 'VALIDATION') return res.status(400).json({ error: e.message });
      console.error('auth error:', e);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  };
}

router.get('/accounts', handle(async (req, res) => {
  res.json({ accounts: session.listAccounts() });
}));

router.post('/create', handle(async (req, res) => {
  const { user, recoveryCode } = session.createAccount(req.body || {});
  res.status(201).json({ user, recoveryCode });
}));

router.post('/login', handle(async (req, res) => {
  const { user } = session.login(req.body || {});
  res.json({ user });
}));

router.post('/logout', handle(async (req, res) => {
  session.logout();
  res.json({ ok: true });
}));

router.get('/me', handle(async (req, res) => {
  res.json({ user: session.getCurrentUser() });
}));

router.post('/reset', handle(async (req, res) => {
  session.resetPassword(req.body || {});
  res.json({ ok: true });
}));

router.post('/change-password', handle(async (req, res) => {
  session.changePassword(req.body || {});
  res.json({ ok: true });
}));

router.post('/regenerate-recovery', handle(async (req, res) => {
  const { recoveryCode } = session.regenerateRecovery(req.body || {});
  res.json({ recoveryCode });
}));

router.post('/delete', handle(async (req, res) => {
  session.deleteAccount(req.body || {});
  res.json({ ok: true });
}));

router.post('/accounts/:id/delete', handle(async (req, res) => {
  session.deleteAccountById({ id: req.params.id, password: (req.body || {}).password });
  res.json({ ok: true });
}));

router.post('/accounts/:id/update', handle(async (req, res) => {
  const body = req.body || {};
  const { user } = session.updateAccount({
    id: req.params.id,
    username: body.username,
    currentPassword: body.currentPassword,
    newPassword: body.newPassword
  });
  res.json({ user });
}));

// ===== Безопасность =====

router.get('/security', handle(async (req, res) => {
  res.json({ security: session.getSecurity() });
}));

router.put('/security', handle(async (req, res) => {
  res.json({ security: session.updateSecurity(req.body || {}) });
}));

router.post('/security/pin', handle(async (req, res) => {
  session.setPin(req.body || {});
  res.json({ ok: true, security: session.getSecurity() });
}));

router.post('/security/pin/remove', handle(async (req, res) => {
  session.removePin(req.body || {});
  res.json({ ok: true, security: session.getSecurity() });
}));

router.post('/security/unlock', handle(async (req, res) => {
  res.json(session.verifyPin(req.body || {}));
}));

router.post('/remember', handle(async (req, res) => {
  const remember = !!(req.body || {}).remember;
  session.setRemember(remember && req.user ? req.user.id : null);
  res.json({ ok: true, remember: !!(remember && req.user) });
}));

router.post('/verify-password', handle(async (req, res) => {
  res.json(session.verifyPassword(req.body || {}));
}));

// ===== Скрипты / терминал =====

router.get('/terminal', handle(async (req, res) => {
  res.json(session.getTerminalSettings(req.query.refresh === '1'));
}));

router.put('/terminal', handle(async (req, res) => {
  res.json(session.updateTerminalSettings(req.body || {}));
}));

// ===== Статистика и данные =====

router.get('/stats', handle(async (req, res) => {
  res.json({ stats: session.getStats() });
}));

router.post('/reset-data', handle(async (req, res) => {
  res.json(session.resetData(req.body || {}));
}));

module.exports = router;
