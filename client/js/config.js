const CONFIG = {
  IS_ELECTRON: !!(typeof window !== 'undefined' && window.nexhub && window.nexhub.isElectron),
  MAX_LOGO_SIZE: 150 * 1024,
  MAX_PHOTO_SIZE: 500 * 1024,
  COLORS: ['#0071e3', '#ff3b30', '#34c759', '#ff9500', '#af52de', '#ff2d55', '#5856d6', '#00c7be', '#ffcc00'],
  STATUSES: ['active', 'paused', 'done', 'archive'],
  STATUS_LABELS: { active: 'В работе', paused: 'На паузе', done: 'Завершён', archive: 'Архив' },
  PRIORITIES: ['p0', 'p1', 'p2', 'p3', 'p4'],
  PRIORITY_LABELS: { p0: 'P0 — Крит', p1: 'P1 — Высокий', p2: 'P2 — Средний', p3: 'P3 — Низкий', p4: 'P4 — Фон' },
  DEFAULT_TEMPLATES: [
    { name: 'Веб-приложение', description: 'Фронтенд + бэкенд', tags: ['web', 'fullstack'], status: 'active' },
    { name: 'Мобильное приложение', description: 'iOS / Android', tags: ['mobile', 'app'], status: 'active' },
    { name: 'Дизайн-проект', description: 'UI/UX, брендинг', tags: ['design'], status: 'active' },
    { name: 'Исследование', description: 'Аналитика, отчёты', tags: ['research'], status: 'paused' }
  ]
};

export default CONFIG;