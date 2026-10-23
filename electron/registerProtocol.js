const { protocol, net } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const { ensureThumbnail } = require('./lib/thumbnails');

function register(paths, electronDir) {
  const clientDir = path.join(electronDir, '..', 'client');

  function isInside(base, target) {
    const rel = path.relative(base, target);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  }

  async function getStat(target) {
    try {
      return await fs.promises.stat(target);
    } catch (e) {
      return null;
    }
  }

  function etagFor(stat) {
    return 'W/"' + stat.mtimeMs + '-' + stat.size + '"';
  }

  protocol.handle('app', async (request) => {
    let pathname;
    try {
      const u = new URL(request.url);
      pathname = decodeURIComponent(u.pathname || '/');
    } catch (e) {
      return new Response('Bad Request', { status: 400 });
    }

    let abs;

    if (pathname.startsWith('/uploads/')) {
      abs = path.join(paths.uploadsDir, pathname.slice('/uploads/'.length));
      if (!isInside(paths.uploadsDir, abs)) {
        return new Response('Forbidden', { status: 403 });
      }

      let stat = await getStat(abs);

      if (pathname.startsWith('/uploads/photos/')) {
        const base = path.basename(abs);
        if (base.startsWith('thumb_') && base.endsWith('.jpg') && (!stat || !stat.isFile())) {
          const original = base.slice('thumb_'.length, -'.jpg'.length);
          const photosDir = path.join(paths.uploadsDir, 'photos');
          const generated = ensureThumbnail(photosDir, original);
          if (generated) {
            abs = path.join(photosDir, generated);
            stat = await getStat(abs);
          }
        }
      }

      if (!stat || stat.isDirectory()) {
        return new Response('Not Found', { status: 404 });
      }

      const res = await net.fetch(pathToFileURL(abs).toString());
      const headers = new Headers(res.headers);
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }

    abs = path.join(clientDir, pathname === '/' ? 'index.html' : pathname.slice(1));
    let stat = await getStat(abs);
    if (!isInside(clientDir, abs) || !stat || stat.isDirectory()) {
      abs = path.join(clientDir, 'index.html');
      stat = await getStat(abs);
    }

    if (!stat) {
      return new Response('Not Found', { status: 404 });
    }

    const etag = etagFor(stat);
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch && ifNoneMatch.split(',').map(function(v) { return v.trim(); }).includes(etag)) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }

    const res = await net.fetch(pathToFileURL(abs).toString());
    const headers = new Headers(res.headers);
    headers.set('Cache-Control', 'no-cache');
    headers.set('ETag', etag);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  });
}

module.exports = { register };
