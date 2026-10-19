// Draws FlowLite's icon in code — an original mark, no third-party artwork — and writes:
//   build/icon.png  (256 px, installer/exe source)
//   build/icon.ico  (16-256 px, PNG-compressed entries)
//   assets/tray.png (16 px) + assets/tray@2x.png (32 px) for the system tray
// Pure Node: shapes are sampled with supersampling, then encoded as PNG/ICO by hand.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- geometry (unit square). `bold` thickens strokes for tiny sizes. ----
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function micShape(x, y, bold) {
  const capsule = bold ? [0.36, 0.14, 0.64, 0.58, 0.14] : [0.385, 0.18, 0.615, 0.58, 0.115];
  if (inRoundRect(x, y, ...capsule)) return true;
  // Stand: lower half of a ring around the capsule.
  const cx = 0.5, cy = 0.47, ro = bold ? 0.235 : 0.195, ri = bold ? 0.165 : 0.155;
  if (y >= cy) {
    const d2 = (x - cx) ** 2 + (y - cy) ** 2;
    if (d2 <= ro * ro && d2 >= ri * ri) return true;
  }
  const stemHalf = bold ? 0.04 : 0.02;
  if (inRoundRect(x, y, 0.5 - stemHalf, 0.64, 0.5 + stemHalf, 0.78, 0)) return true; // stem
  return bold
    ? inRoundRect(x, y, 0.32, 0.76, 0.68, 0.84, 0.04) // base
    : inRoundRect(x, y, 0.37, 0.745, 0.63, 0.79, 0.022);
}

// ---- rasterise to straight-alpha RGBA ----
function render(size) {
  const bold = size <= 32;
  const ss = size <= 32 ? 8 : 4;
  const top = [0x4f, 0x46, 0xe5]; // indigo
  const bottom = [0x7c, 0x3a, 0xed]; // violet
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let tile = 0, white = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;
          if (inRoundRect(x, y, 0.03, 0.03, 0.97, 0.97, 0.22)) {
            tile++;
            if (micShape(x, y, bold)) white++;
          }
        }
      }
      if (tile === 0) continue;
      const t = size > 1 ? py / (size - 1) : 0;
      const w = white / tile;
      const o = (py * size + px) * 4;
      for (let i = 0; i < 3; i++) {
        const bg = top[i] + (bottom[i] - top[i]) * t;
        buf[o + i] = Math.round(bg * (1 - w) + 255 * w);
      }
      buf[o + 3] = Math.round((tile / (ss * ss)) * 255);
    }
  }
  return buf;
}

// ---- PNG encoder ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- ICO container with PNG entries ----
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; // 0 means 256
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const png = (size) => encodePng(size, render(size));
mkdirSync(join(root, 'build'), { recursive: true });
mkdirSync(join(root, 'assets'), { recursive: true });
writeFileSync(join(root, 'build', 'icon.png'), png(256));
writeFileSync(join(root, 'build', 'icon.ico'), encodeIco([16, 24, 32, 48, 64, 128, 256].map((s) => ({ size: s, data: png(s) }))));
writeFileSync(join(root, 'assets', 'tray.png'), png(16));
writeFileSync(join(root, 'assets', 'tray@2x.png'), png(32));
console.log('make-icon: wrote build/icon.png, build/icon.ico, assets/tray.png, assets/tray@2x.png');
