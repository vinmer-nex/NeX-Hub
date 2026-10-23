const fs = require('fs');
const path = require('path');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

function readPngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;

  entries.forEach((entry, i) => {
    const { width, height } = readPngSize(entry.data);
    const w = width >= 256 ? 0 : width;
    const h = height >= 256 ? 0 : height;
    const base = i * 16;
    dir.writeUInt8(w, base);
    dir.writeUInt8(h, base + 1);
    dir.writeUInt8(0, base + 2);
    dir.writeUInt8(0, base + 3);
    dir.writeUInt16LE(1, base + 4);
    dir.writeUInt16LE(32, base + 6);
    dir.writeUInt32LE(entry.data.length, base + 8);
    dir.writeUInt32LE(offset, base + 12);
    offset += entry.data.length;
  });

  return Buffer.concat([header, dir, ...entries.map(e => e.data)]);
}

const dir = path.join(__dirname, '..', 'build', 'icons');
const entries = SIZES.map(size => ({
  size,
  data: fs.readFileSync(path.join(dir, `icon-${size}.png`))
}));

fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.ico'), buildIco(entries));
fs.copyFileSync(path.join(dir, 'icon-512.png'), path.join(__dirname, '..', 'build', 'icon.png'));

const assets = path.join(__dirname, '..', 'electron', 'assets');
fs.mkdirSync(assets, { recursive: true });
fs.copyFileSync(path.join(dir, 'icon-512.png'), path.join(assets, 'icon.png'));
fs.copyFileSync(path.join(dir, 'icon-256.png'), path.join(assets, 'icon-256.png'));
fs.copyFileSync(path.join(__dirname, '..', 'build', 'icon.ico'), path.join(assets, 'icon.ico'));

console.log('icon.ico, icon.png and electron/assets created');
