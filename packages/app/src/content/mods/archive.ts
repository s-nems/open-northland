import { openZipFiles } from '@open-northland/map-import';
import { validateContentModPatch } from './merge.js';

export interface ContentModFiles {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly files: readonly { readonly path: string; readonly bytes: Uint8Array }[];
}

const decoder = new TextDecoder('utf-8', { fatal: true });

function contentRoot(files: ReadonlyMap<string, Uint8Array>): string {
  const candidates = [...files.keys()].filter((path) => path === 'ir.json' || path.endsWith('/ir.json'));
  if (candidates.length !== 1) throw new Error('ZIP pack must contain exactly one content/ir.json');
  const path = candidates[0];
  if (path === undefined) throw new Error('ZIP pack must contain content/ir.json');
  return path.slice(0, -'ir.json'.length);
}

function modName(filename: string): string {
  const name = filename.replace(/\.zip$/i, '').trim();
  if (name.length === 0 || name.length > 100) throw new Error('Pack name must be 1 to 100 characters');
  return name;
}

export async function readContentMod(filename: string, archive: Uint8Array): Promise<ContentModFiles> {
  const tree = await openZipFiles(archive, { name: filename });
  const root = contentRoot(tree.files);
  const rawIr = tree.files.get(`${root}ir.json`);
  if (rawIr === undefined) throw new Error('ZIP pack must contain content/ir.json');
  let document: unknown;
  try {
    document = JSON.parse(decoder.decode(rawIr));
  } catch (error) {
    throw new Error(`content/ir.json is not valid UTF-8 JSON: ${String(error)}`);
  }
  validateContentModPatch(document);

  const files = [...tree.files]
    .filter(([path]) => path.startsWith(root))
    .map(([path, bytes]) => ({ path: path.slice(root.length), bytes }));
  if (files.some((file) => file.path.length === 0)) throw new Error('Pack contains an invalid content path');
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(archive));
  const id = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return { id, name: modName(filename), size: archive.byteLength, files };
}
