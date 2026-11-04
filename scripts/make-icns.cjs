// Wraps a square PNG in an .icns container (PNG-compressed icon entries, which
// macOS 10.7+ reads natively). Dependency-free; used to (re)generate
// build/icon.icns and build/mdz.icns on any OS:
//   node scripts/make-icns.cjs build/icon.png build/icon.icns
//   node scripts/make-icns.cjs build/file-icons/mdz.png build/mdz.icns
const fs = require('fs');
const [src, dest] = process.argv.slice(2);
const png = fs.readFileSync(src);
const size = png.readUInt32BE(16); // IHDR width (square assumed)
const types = { 128: 'ic07', 256: 'ic08', 512: 'ic09', 1024: 'ic10' };
if (!types[size]) throw new Error(`Unsupported PNG size ${size}; expected 128, 256, 512 or 1024`);
const head = Buffer.alloc(8);
head.write(types[size], 0, 'ascii');
head.writeUInt32BE(png.length + 8, 4);
const entry = Buffer.concat([head, png]);
const file = Buffer.alloc(8);
file.write('icns', 0, 'ascii');
file.writeUInt32BE(entry.length + 8, 4);
fs.writeFileSync(dest, Buffer.concat([file, entry]));
console.log(`${dest}: ${size}x${size} (${types[size]})`);
