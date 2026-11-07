// Wraps square PNGs in an .icns container (PNG-compressed entries, which macOS
// 10.7+ reads natively). Dependency-free; used to (re)generate
// build/icon.icns and build/mdz.icns on any OS.
//
// Single PNG (one entry, type chosen from its pixel size):
//   node scripts/make-icns.cjs build/file-icons/mdz.png build/mdz.icns
//
// Full set (every size the PNGs supply, including the @2x types):
//   node scripts/make-icns.cjs --set build/icon.icns build/icon-src/mdzip-mark-square-*.png
//
// Pixel size -> icns types. A 32px PNG is written as both icp5 (32) and ic11
// (16@2x), and so on for 64, 256 and 512. 1024px is ic10 (512@2x).
const fs = require('fs');

const TYPES_BY_SIZE = {
  16: ['icp4'],
  32: ['icp5', 'ic11'],
  64: ['icp6', 'ic12'],
  128: ['ic07'],
  256: ['ic08', 'ic13'],
  512: ['ic09', 'ic14'],
  1024: ['ic10'],
};

function readPng(file) {
  const png = fs.readFileSync(file);
  const sig = '89504e470d0a1a0a';
  if (png.length < 24 || png.toString('hex', 0, 8) !== sig || png.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`${file}: not a PNG`);
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== height) throw new Error(`${file}: ${width}x${height} is not square`);
  if (!TYPES_BY_SIZE[width]) {
    throw new Error(`${file}: unsupported size ${width}; expected ${Object.keys(TYPES_BY_SIZE).join(', ')}`);
  }
  return { file, size: width, png };
}

function entry(type, png) {
  const head = Buffer.alloc(8);
  head.write(type, 0, 'ascii');
  head.writeUInt32BE(png.length + 8, 4);
  return Buffer.concat([head, png]);
}

function writeIcns(dest, entries) {
  const body = Buffer.concat(entries);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  fs.writeFileSync(dest, Buffer.concat([head, body]));
}

const args = process.argv.slice(2);
if (args[0] === '--set') {
  const [, dest, ...sources] = args;
  if (!dest || sources.length === 0) throw new Error('usage: --set <dest.icns> <png...>');
  const bySize = new Map();
  for (const src of sources) {
    const img = readPng(src);
    if (bySize.has(img.size)) throw new Error(`two PNGs at ${img.size}px: ${bySize.get(img.size).file} and ${src}`);
    bySize.set(img.size, img);
  }
  const entries = [];
  const listed = [];
  for (const size of Object.keys(TYPES_BY_SIZE).map(Number).sort((a, b) => a - b)) {
    const img = bySize.get(size);
    if (!img) continue;
    for (const type of TYPES_BY_SIZE[size]) {
      entries.push(entry(type, img.png));
      listed.push(`${type} (${size}px)`);
    }
  }
  writeIcns(dest, entries);
  console.log(`${dest}: ${listed.join(', ')}`);
} else {
  const [src, dest] = args;
  if (!src || !dest) throw new Error('usage: make-icns.cjs <src.png> <dest.icns>  |  make-icns.cjs --set <dest.icns> <png...>');
  const img = readPng(src);
  const type = TYPES_BY_SIZE[img.size][0];
  writeIcns(dest, [entry(type, img.png)]);
  console.log(`${dest}: ${img.size}x${img.size} (${type})`);
}
