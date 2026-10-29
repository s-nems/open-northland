import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BookOverlay,
  CampaignOverlay,
  type FiledObjectTableOverlay,
  LANGUAGES,
  type Language,
  MapOverlay,
  ObjectTableOverlay,
  OVERLAY_EDIT_SUFFIX,
  PersonalNameOverlay,
  splitOverlayEdit,
} from '@open-northland/data';
import { MapOverlayFiling, type MapOverlaysByDatKey } from './map-filing.js';

/** The repository's `translations/` directory, resolved from this package so any working directory works. */
export const TRANSLATIONS_ROOT = fileURLToPath(new URL('../../../translations/', import.meta.url));

/** The folders under `translations/<lang>/`, one per overlay schema. */
export const OVERLAY_KINDS = ['maps', 'objects', 'books', 'campaigns', 'names'] as const;
export type OverlayKind = (typeof OVERLAY_KINDS)[number];

const OVERLAY_EXTENSION = '.json';

interface OverlayByKind {
  readonly maps: MapOverlay;
  readonly objects: ObjectTableOverlay;
  readonly books: BookOverlay;
  readonly campaigns: CampaignOverlay;
  readonly names: PersonalNameOverlay;
}

/** The part of a zod schema the loader uses, so this package needs no zod import of its own. */
interface Schema<T> {
  safeParse(value: unknown):
    | { readonly success: true; readonly data: T }
    | {
        readonly success: false;
        readonly error: {
          readonly issues: readonly { readonly path: readonly PropertyKey[]; message: string }[];
        };
      };
}

const SCHEMAS: { readonly [K in OverlayKind]: Schema<OverlayByKind[K]> } = {
  maps: MapOverlay,
  objects: ObjectTableOverlay,
  books: BookOverlay,
  campaigns: CampaignOverlay,
  names: PersonalNameOverlay,
};

/** Every overlay of the repository, validated, keyed the way the stages look them up. */
export interface TranslationOverlays {
  /** Map overlays by the raw `map.dat` SHA-256 hex digest, then language. */
  readonly maps: MapOverlaysByDatKey;
  /** Game-object name tables by language, then table (`goods`, `houses`, `jobs`, ...), each with its
   *  project edit when one is filed. */
  readonly objects: ReadonlyMap<Language, ReadonlyMap<string, FiledObjectTableOverlay>>;
  /** Hypertext books by language, then book (`history`). */
  readonly books: ReadonlyMap<Language, ReadonlyMap<string, BookOverlay>>;
  /** Campaign titles by language, then campaign id. */
  readonly campaigns: ReadonlyMap<Language, ReadonlyMap<string, CampaignOverlay>>;
  /** Localized personal names by language, then the pool the file name names (`viking-male`), each with
   *  the pool's raw spelling as its key. */
  readonly names: ReadonlyMap<Language, ReadonlyMap<string, PersonalNameOverlay>>;
}

/** A path as a diagnostic names it: `/`-separated on every platform, so one overlay is reported the
 *  same whichever host produced the message. */
export function diagnosticPath(...parts: readonly string[]): string {
  return join(...parts).replaceAll(sep, '/');
}

/** Reads and validates one overlay file; a malformed one throws naming the path and the first issue. */
export async function readOverlayFile<K extends OverlayKind>(
  kind: K,
  path: string,
): Promise<OverlayByKind[K]> {
  const named = diagnosticPath(path);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    throw new Error(`${named}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const result = SCHEMAS[kind].safeParse(raw);
  if (result.success) return result.data;
  const [issue] = result.error.issues;
  const where =
    issue === undefined || issue.path.length === 0 ? '' : ` at ${issue.path.map(String).join('.')}`;
  throw new Error(`${named}: invalid ${kind} overlay${where}: ${issue?.message ?? 'unknown issue'}`);
}

/** The entries of `dir` sorted by name, or none when it does not exist. */
export async function listDirectory(dir: string): Promise<Dirent[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return [];
    throw err;
  }
}

/** The overlay files of one kind of one language, by the id their file name carries. */
async function readKind<K extends OverlayKind>(
  root: string,
  lang: Language,
  kind: K,
): Promise<Map<string, OverlayByKind[K]>> {
  const dir = join(root, lang, kind);
  const files = new Map<string, OverlayByKind[K]>();
  for (const entry of await listDirectory(dir)) {
    if (!entry.isFile() || !entry.name.endsWith(OVERLAY_EXTENSION)) continue;
    files.set(
      entry.name.slice(0, -OVERLAY_EXTENSION.length),
      await readOverlayFile(kind, join(dir, entry.name)),
    );
  }
  return files;
}

/** Files one language's map overlays, then their edits; a misnamed file, a second one of the same basis
 *  or an edit without its overlay throws. */
async function readMaps(root: string, lang: Language, filing: MapOverlayFiling): Promise<void> {
  const files = await readKind(root, lang, 'maps');
  const refuse = (id: string, refusal: string): never => {
    throw new Error(`${diagnosticPath(root, lang, 'maps', `${id}.json`)}: ${refusal}`);
  };
  for (const [id, overlay] of files) {
    const { name, edit } = splitOverlayEdit(id);
    if (edit) continue;
    const refusal = filing.file(lang, name, overlay);
    if (refusal !== undefined) refuse(id, refusal);
  }
  for (const [id, overlay] of files) {
    const { name, edit } = splitOverlayEdit(id);
    if (!edit) continue;
    const refusal = filing.edit(lang, name, overlay);
    if (refusal !== undefined) refuse(id, refusal);
  }
}

/** One language's object tables with their edits attached; an edit without its table throws. */
async function readObjects(root: string, lang: Language): Promise<Map<string, FiledObjectTableOverlay>> {
  const files = await readKind(root, lang, 'objects');
  const tables = new Map<string, { edit?: ObjectTableOverlay } & ObjectTableOverlay>();
  for (const [id, overlay] of files) if (!splitOverlayEdit(id).edit) tables.set(id, { ...overlay });
  for (const [id, overlay] of files) {
    const { name, edit } = splitOverlayEdit(id);
    if (!edit) continue;
    const table = tables.get(name);
    if (table === undefined)
      throw new Error(
        `${diagnosticPath(root, lang, 'objects', `${id}.json`)}: an edit needs the overlay it edits beside it, ${name}.json`,
      );
    if (table.edit !== undefined)
      throw new Error(
        `${diagnosticPath(root, lang, 'objects', `${id}.json`)}: ${name}${OVERLAY_EDIT_SUFFIX}.json is filed already`,
      );
    table.edit = overlay;
  }
  return tables;
}

/**
 * Loads every overlay under `root` (`<lang>/<kind>/<id>.json`). Only known languages and kinds are read;
 * `npm run check:translations` reports anything else. A missing root holds no overlays.
 */
export async function loadTranslationOverlays(
  root: string = TRANSLATIONS_ROOT,
): Promise<TranslationOverlays> {
  const maps = new MapOverlayFiling();
  const objects = new Map<Language, ReadonlyMap<string, FiledObjectTableOverlay>>();
  const books = new Map<Language, ReadonlyMap<string, BookOverlay>>();
  const campaigns = new Map<Language, ReadonlyMap<string, CampaignOverlay>>();
  const names = new Map<Language, ReadonlyMap<string, PersonalNameOverlay>>();
  const present = new Set((await listDirectory(root)).filter((e) => e.isDirectory()).map((e) => e.name));
  for (const lang of LANGUAGES) {
    if (!present.has(lang)) continue;
    await readMaps(root, lang, maps);
    const put = <T>(into: Map<Language, ReadonlyMap<string, T>>, files: ReadonlyMap<string, T>): void => {
      if (files.size > 0) into.set(lang, files);
    };
    put(objects, await readObjects(root, lang));
    put(books, await readKind(root, lang, 'books'));
    put(campaigns, await readKind(root, lang, 'campaigns'));
    put(names, await readKind(root, lang, 'names'));
  }
  return { maps: maps.maps, objects, books, campaigns, names };
}
