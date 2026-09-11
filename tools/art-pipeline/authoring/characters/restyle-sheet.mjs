import sharp from 'sharp';
import { alphaBox, CELL_H, CELL_W, parseArgs } from './sprite-post.mjs';

const args = parseArgs(process.argv.slice(2), {
  cols: '4',
  rows: '2',
  cell: '384x512',
  feet: '440',
  height: '264',
  cells: '8',
});
if (!args.out || (!args.files && !args.strip)) {
  console.error(
    'usage: node restyle-sheet.mjs --out <png> (--files a,b,... | --strip <png>) [--cols 4 --rows 2 --cell 384x512 --feet 440 --height 264] [--nearest]',
  );
  process.exit(1);
}
const cols = Number(args.cols),
  rows = Number(args.rows),
  feet = Number(args.feet),
  height = Number(args.height);
const [cellW, cellH] = args.cell.split('x').map(Number);

let sources;
if (args.files) {
  sources = args.files.split(',').map((f) => sharp(f));
} else {
  const n = Number(args.cells);
  sources = Array.from({ length: n }, (_, i) =>
    sharp(args.strip).extract({ left: i * CELL_W, top: 0, width: CELL_W, height: CELL_H }),
  );
}
const figures = [];
for (const src of sources) {
  const buf = await src.png().toBuffer();
  const box = await alphaBox(buf);
  figures.push({ buf: await sharp(buf).extract(box).png().toBuffer(), box });
}
const tallest = Math.max(...figures.map((f) => f.box.height));
const scale = height / tallest;
const kernel = args.nearest ? 'nearest' : 'lanczos3';
const composites = [];
for (let i = 0; i < figures.length && i < cols * rows; i++) {
  const { buf, box } = figures[i];
  const w = Math.max(1, Math.round(box.width * scale)),
    h = Math.max(1, Math.round(box.height * scale));
  const scaled = await sharp(buf).resize(w, h, { kernel }).png().toBuffer();
  const col = i % cols,
    row = Math.floor(i / cols);
  composites.push({
    input: scaled,
    left: col * cellW + Math.round(cellW / 2 - w / 2),
    top: row * cellH + feet - h,
  });
}
await sharp({
  create: {
    width: cols * cellW,
    height: rows * cellH,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite(composites)
  .png()
  .toFile(args.out);
console.log(
  args.out,
  `${cols * cellW}x${rows * cellH}`,
  `${figures.length} figures, scale ${scale.toFixed(3)}`,
);
