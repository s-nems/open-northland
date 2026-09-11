import fs from 'node:fs/promises';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const files = (await fs.readdir(new URL('projected/', root))).filter((f) => /^texture.*\.png$/.test(f));
const report = [];
for (const file of files) {
  const { data, info } = await sharp(new URL('projected/' + file, root).pathname)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raw = await sharp(new URL('.work/projected/' + file, root).pathname)
    .ensureAlpha()
    .raw()
    .toBuffer();
  const base = await sharp(new URL('model/rigged-base-0.png', root).pathname)
    .resize(info.width, info.height)
    .ensureAlpha()
    .raw()
    .toBuffer();
  let linen = 0,
    magenta = 0;
  for (let i = 0; i < data.length; i += 4) {
    const y = Math.floor(i / 4 / info.width),
      [r, g, b] = raw.subarray(i, i + 3);
    const skirt = y < info.height * 0.25;
    if (skirt && r >= g && g >= b && b > 80 && (r - b) / Math.max(1, r) < 0.5) {
      data.set(raw.subarray(i, i + 3), i);
      linen++;
    }
    const [cr, cg, cb] = data.subarray(i, i + 3);
    if (cr > 100 && cb > cg * 0.9 && cg < cr * 0.82) {
      data.set(base.subarray(i, i + 3), i);
      magenta++;
    }
  }
  await sharp(data, { raw: info })
    .png()
    .toFile(new URL('projected/' + file, root).pathname);
  report.push({ file, linen, magenta });
}
console.log(JSON.stringify(report));
