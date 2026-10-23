const fs = require('fs');
const path = require('path');

function createRouter() {
  const routes = [];
  const middlewares = [];
  const r = {
    use(fn) { middlewares.push(fn); return r; },
    add(method, pattern, handler) {
      routes.push({ method: method.toUpperCase(), pattern, handler });
      return r;
    },
    get(p, h) { return r.add('GET', p, h); },
    post(p, h) { return r.add('POST', p, h); },
    put(p, h) { return r.add('PUT', p, h); },
    delete(p, h) { return r.add('DELETE', p, h); },
    _routes: routes,
    _middlewares: middlewares
  };
  return r;
}

function makeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined, file: null, __ended: false };
  res.status = c => { res.statusCode = c; return res; };
  res.json = o => { res.body = o; res.__ended = true; return res; };
  res.send = d => { res.body = d; res.__ended = true; return res; };
  res.sendFile = p => { res.file = p; res.__ended = true; return res; };
  res.download = p => { res.file = p; res.__ended = true; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  res.type = () => res;
  return res;
}

function matchRoute(pattern, subPath) {
  const pParts = String(pattern).split('/').filter(Boolean);
  const sParts = String(subPath).split('/').filter(Boolean);
  if (pParts.length !== sParts.length) return null;

  const params = {};
  for (let i = 0; i < pParts.length; i++) {
    const pp = pParts[i];
    if (pp.startsWith(':')) {
      params[pp.slice(1)] = decodeURIComponent(sParts[i]);
    } else if (pp !== sParts[i]) {
      return null;
    }
  }
  return { params };
}

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  tiff: 'image/tiff',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  txt: 'text/plain',
  json: 'application/json',
  html: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  zip: 'application/zip'
};

function mimeFor(ext) {
  return MIME[String(ext || '').toLowerCase()] || 'application/octet-stream';
}

async function finalize(res) {
  if (res.file) {
    const buf = await fs.promises.readFile(res.file);
    return {
      status: res.statusCode,
      body: {
        __binary: true,
        buffer: buf,
        mime: mimeFor(path.extname(res.file).slice(1).toLowerCase())
      }
    };
  }
  return { status: res.statusCode, body: res.body };
}

async function dispatch(mounts, method, fullUrl, ctx) {
  ctx = ctx || {};
  const raw = String(fullUrl || '/');
  const qIndex = raw.indexOf('?');
  const pathPart = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const queryStr = qIndex === -1 ? '' : raw.slice(qIndex + 1);

  const query = {};
  try {
    const sp = new URLSearchParams(queryStr);
    for (const [k, v] of sp.entries()) query[k] = v;
  } catch (e) {
    // некорректная query-строка — игнорируем
  }

  const pathname = pathPart || '/';
  const httpMethod = String(method || 'GET').toUpperCase();

  let mount = null;
  let sub = '/';
  for (const m of mounts) {
    const prefix = m.prefix;
    if (pathname === prefix || pathname.startsWith(prefix + '/')) {
      mount = m;
      sub = pathname.slice(prefix.length) || '/';
      break;
    }
  }

  if (!mount || !mount.router) {
    return { status: 404, body: { error: 'Не найдено' } };
  }

  const routes = mount.router._routes || [];
  const middlewares = mount.router._middlewares || [];

  const candidates = [];
  for (const route of routes) {
    if (route.method !== httpMethod) continue;
    const match = matchRoute(route.pattern, sub);
    if (match) candidates.push({ route, match, isDynamic: route.pattern.includes(':') });
  }

  // Сначала литеральные (без ':'), потом параметрические
  candidates.sort((a, b) => (a.isDynamic === b.isDynamic ? 0 : a.isDynamic ? 1 : -1));
  const found = candidates[0] || null;

  if (!found) {
    return { status: 404, body: { error: 'Не найдено' } };
  }

  const req = {
    params: found.match.params,
    query,
    body: ctx.body || {},
    user: ctx.user || null,
    files: ctx.files || [],
    headers: ctx.headers || {}
  };
  const res = makeRes();

  try {
    for (const mw of middlewares) {
      let advanced = false;
      await mw(req, res, () => { advanced = true; });
      if (res.__ended) {
        return await finalize(res);
      }
    }

    await found.route.handler(req, res);
    return await finalize(res);
  } catch (e) {
    console.error('dispatch error:', e);
    return { status: 500, body: { error: 'Ошибка сервера' } };
  }
}

module.exports = { createRouter, dispatch, makeRes, matchRoute, mimeFor };
