import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { alphaBox, parseArgs } from './sprite-post.mjs';

// Cell order of the facings grid: the rotation the --files of restyle-sheet.mjs list, not the atlas order.
const GRID_FACINGS = ['SW', 'W', 'NW', 'N', 'NE', 'E', 'SE', 'S'];
const args = parseArgs(process.argv.slice(2), { cols: '4', rows: '2', cell: '384x512', angle: '35' });
if (!args.sheet || !args.out || (!args.facings && !args.frames)) {
  console.error(
    'usage: node restyle-cut.mjs --sheet <png> --out <dir> [--cols 4 --rows 2 --cell 384x512] (--facings [--angle 35] | --frames)',
  );
  process.exit(1);
}
const cols = Number(args.cols),
  rows = Number(args.rows);
const [cellW, cellH] = args.cell.split('x').map(Number);
const dir = args.facings ? path.join(args.out, `${args.angle}deg`) : args.out;
fs.mkdirSync(dir, { recursive: true });
const count = args.facings ? GRID_FACINGS.length : cols * rows;
for (let i = 0; i < count; i++) {
  const col = i % cols,
    row = Math.floor(i / cols);
  const region = { left: col * cellW, top: row * cellH, width: cellW, height: cellH };
  const buf = await sharp(args.sheet).extract(region).png().toBuffer();
  const box = await alphaBox(buf);
  const name = args.facings ? `${GRID_FACINGS[i]}.png` : `f${String(i).padStart(2, '0')}.png`;
  await sharp(buf).toFile(path.join(dir, name));
  const touches =
    box.left === 0 || box.top === 0 || box.left + box.width === cellW || box.top + box.height === cellH;
  console.log(
    name,
    `${box.width}x${box.height} at ${box.left},${box.top}${touches ? '  WARNING: touches the cell border' : ''}`,
  );
}
