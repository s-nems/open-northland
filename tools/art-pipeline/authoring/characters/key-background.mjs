import sharp from 'sharp';

const [input, output, mode] = process.argv.slice(2);
if (!input || !output) throw new Error('usage: node key-background.mjs <generated PNG> <transparent PNG>');
const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
if (mode !== '--any-size' && (info.width !== 1536 || info.height !== 1024))
  throw new Error('Expected a 1536x1024 four-by-two paint sheet');
let transparent = 0;
for (let i = 0; i < data.length; i += 4) {
  const [r, g, b] = data.subarray(i, i + 3);
  if (r > g * 1.5 + 30 && b > g * 1.5 + 30 && r > 120 && b > 90) data[i + 3] = 0;
  if (data[i + 3] === 0) transparent++;
}
if (transparent < (data.length / 4) * 0.2)
  throw new Error('Background is neither transparent nor magenta; repair it with imagegen before projecting');
await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
  .png()
  .toFile(output);
console.log({ transparent });
