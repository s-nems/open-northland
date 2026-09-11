import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
export const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}
export async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
export async function listFiles(root: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of (await readdir(join(root, prefix), { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Symlink not allowed in delivery: ${path}`);
    if (entry.isDirectory()) files.push(...(await listFiles(root, path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
export async function hashes(root: string) {
  const result: Record<string, string> = {};
  for (const file of await listFiles(root)) result[file] = digest(await readFile(join(root, file)));
  return result;
}
export function fingerprint(files: Record<string, string>) {
  return digest(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))));
}
