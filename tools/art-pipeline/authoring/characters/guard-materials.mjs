import fs from 'node:fs/promises';
import sharp from 'sharp';

const [baseFile, sourceDir, outputDir] = process.argv.slice(2);
function family(r, g, b) {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  if (max < 35 || d / max < 0.28) return 0;
  let h = max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return h > 150 && h < 270 ? 1 : 2;
}
await fs.mkdir(outputDir, { recursive: true });
for (const file of (await fs.readdir(sourceDir)).filter((f) => /^texture.*\.png$/.test(f))) {
  const { data, info } = await sharp(sourceDir + '/' + file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const base = await sharp(baseFile)
    .resize(info.width, info.height, { kernel: 'nearest' })
    .ensureAlpha()
    .raw()
    .toBuffer();
  let changed = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (family(...base.subarray(i, i + 3)) !== family(...data.subarray(i, i + 3))) {
      data.set(base.subarray(i, i + 3), i);
      changed++;
    }
  }
  await sharp(data, { raw: info })
    .png()
    .toFile(outputDir + '/' + file);
  console.log(file, ((100 * changed) / (info.width * info.height)).toFixed(1) + '% fallback');
}
