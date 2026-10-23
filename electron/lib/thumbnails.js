const { nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const THUMB_WIDTH = 320;
const THUMB_QUALITY = 78;

const SUPPORTED_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp']);
const UNSUPPORTED_EXTS = new Set(['gif', 'svg', 'avif', 'ico', 'tiff', 'tif']);

function thumbName(filename) {
  if (!filename || typeof filename !== 'string') return null;
  const ext = path.extname(filename).slice(1).toLowerCase();
  if (!SUPPORTED_EXTS.has(ext) || UNSUPPORTED_EXTS.has(ext)) return null;
  return 'thumb_' + filename + '.jpg';
}

function ensureThumbnail(dir, filename) {
  try {
    const name = thumbName(filename);
    if (!name) return null;

    const src = path.join(dir, filename);
    const dest = path.join(dir, name);

    if (fs.existsSync(dest)) return name;
    if (!fs.existsSync(src)) return null;

    const srcStat = fs.statSync(src);
    if (!srcStat.isFile() || srcStat.size <= 0) return null;

    const image = nativeImage.createFromPath(src);
    if (image.isEmpty()) return null;

    const size = image.getSize();
    if (!size || !size.width) return null;

    const resized = image.resize({
      width: Math.min(THUMB_WIDTH, size.width),
      quality: 'good'
    });
    const buffer = resized.toJPEG(THUMB_QUALITY);
    if (!buffer || !buffer.length) return null;

    fs.writeFileSync(dest, buffer);
    return name;
  } catch (e) {
    return null;
  }
}

module.exports = { THUMB_WIDTH, THUMB_QUALITY, thumbName, ensureThumbnail };
