import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { digest, fingerprint, listFiles } from './files.js';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => [key, canonical(v)]),
    );
  return value;
}
export async function presentationDigest(directory: string, paths?: string[]) {
  const files: Record<string, string> = {};
  for (const file of paths ?? (await listFiles(directory))) {
    const bytes = await readFile(join(directory, file));
    if (file.endsWith('.json'))
      files[file] = digest(JSON.stringify(canonical(JSON.parse(bytes.toString('utf8')))));
    else if (file.endsWith('.png')) {
      const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      files[file] = digest(
        Buffer.concat([Buffer.from(`${info.width}:${info.height}:${info.channels}:`), data]),
      );
    } else throw new Error(`Unsupported presentation file: ${file}`);
  }
  return fingerprint(files);
}
