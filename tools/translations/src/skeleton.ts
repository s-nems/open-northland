#!/usr/bin/env node
/**
 * Writes a map overlay skeleton for every map of a map archive or folder, or for the selected maps of the
 * unpacked data pack, campaign maps included: each string and briefing block of the basis language with
 * its source text as the value, for a translator to replace in place. Usage: `docs/DEVELOPMENT.md`.
 */

import { realpathSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  isLanguage,
  isSourceLanguage,
  LANGUAGES,
  type Language,
  MAP_TEXT_LANGUAGES,
  MapOverlay,
  mapOverlayFileId,
  OVERLAY_VERSION,
  SOURCE_LANGUAGES,
  type SourceLanguage,
} from '@open-northland/data';
import {
  DEFAULT_ROOT_NAME,
  findMapFolders,
  isMapTextFile,
  MAP_DAT_FILE,
  type MapLanguageText,
  type MapSourceText,
  type MapTree,
  mapIdFromPath,
  mapSourceTextDigest,
  openArchive,
  readMapSourceText,
  treeFromFolder,
} from '@open-northland/map-import';
import { readOverlayFile, TRANSLATIONS_ROOT } from '@open-northland/translations';
import { type PackMap, readPackText } from './pack-text.js';

/** One map folder's skeleton; or the earlier folder with the same `map.dat` and basis text, whose
 *  skeleton serves it too; or why it gets none. */
export type MapSkeleton =
  | {
      readonly kind: 'skeleton';
      readonly folder: string;
      readonly digest: string;
      readonly overlay: MapOverlay;
    }
  | { readonly kind: 'shared'; readonly folder: string; readonly sharesWith: string }
  | { readonly kind: 'refused'; readonly folder: string; readonly refusal: string };

export interface SkeletonLanguages {
  /** The overlay's language. */
  readonly lang: Language;
  /** The language to translate from; by default the first source language the map ships. */
  readonly basis?: SourceLanguage;
}

export interface SkeletonOptions extends SkeletonLanguages {
  /** The name a map at the tree root takes: the archive's or folder's own. */
  readonly rootName: string;
}

/** The overlay of a map named `map` whose every entry is the `basis` source text, valid as written. */
function skeletonOverlay(map: string, basis: SourceLanguage, text: MapLanguageText): MapOverlay {
  return MapOverlay.parse({
    version: OVERLAY_VERSION,
    map,
    basis: { lang: basis, digest: mapSourceTextDigest(text.strings, text.briefings) },
    strings: { ...text.strings },
    briefings: Object.fromEntries(text.briefings),
  });
}

/** The spelled path of folder `key`; a map at the tree root takes `rootName`. */
function spelledFolder(tree: MapTree, key: string, rootName: string): string {
  if (key === '') return rootName;
  const dat = `${key}/${MAP_DAT_FILE}`;
  const spelled = tree.names.get(dat) ?? dat;
  return spelled.slice(0, spelled.lastIndexOf('/'));
}

const hasEntries = (text: MapLanguageText | undefined): text is MapLanguageText =>
  text !== undefined && (Object.keys(text.strings).length > 0 || text.briefings.size > 0);

/** One map whose text a skeleton translates: where it sits, the alias its overlay names it by and its text. */
interface MapTextEntry {
  readonly folder: string;
  readonly map: string;
  readonly text: MapSourceText;
}

/** The skeleton of each map in order; one per `map.dat` digest and basis text. */
function skeletonsOf(entries: Iterable<MapTextEntry>, options: SkeletonLanguages): MapSkeleton[] {
  const { lang } = options;
  const skeletons: MapSkeleton[] = [];
  /** The first folder of each `map.dat` digest and basis digest. */
  const folderByText = new Map<string, string>();
  for (const { folder, map, text } of entries) {
    const refuse = (refusal: string): void => {
      skeletons.push({ kind: 'refused', folder, refusal });
    };
    const shipped = MAP_TEXT_LANGUAGES.filter(isSourceLanguage).filter((source) =>
      hasEntries(text.languages[source]),
    );
    const basis = options.basis ?? shipped[0];
    if (basis === undefined) {
      refuse(`the map ships no ${SOURCE_LANGUAGES.join(', ')} text to translate from`);
      continue;
    }
    const source = text.languages[basis];
    if (!hasEntries(source)) {
      refuse(`the map ships no ${basis} text; it ships ${shipped.join(', ') || 'none'}`);
      continue;
    }
    if (lang !== basis && text.languages[lang] !== undefined) {
      const edit = isSourceLanguage(lang) ? `; --basis ${lang} writes an edit template` : '';
      refuse(`the map ships ${lang} text itself, which wins over an overlay${edit}`);
      continue;
    }
    const overlay = skeletonOverlay(map, basis, source);
    const textKey = `${text.datDigest}/${overlay.basis.digest}`;
    const twin = folderByText.get(textKey);
    if (twin !== undefined) {
      skeletons.push({ kind: 'shared', folder, sharesWith: twin });
      continue;
    }
    folderByText.set(textKey, folder);
    skeletons.push({ kind: 'skeleton', folder, digest: text.datDigest, overlay });
  }
  return skeletons;
}

/** The skeleton of every map folder in `tree`, in path order; one per `map.dat` digest and basis text. */
export async function mapSkeletons(tree: MapTree, options: SkeletonOptions): Promise<MapSkeleton[]> {
  const entries: MapTextEntry[] = [];
  for (const key of findMapFolders(tree)) {
    const text = await readMapSourceText(tree, key);
    // findMapFolders lists only folders that hold a map.dat.
    if (text === undefined) continue;
    const folder = spelledFolder(tree, key, options.rootName);
    // A folder name without a Latin letter or digit slugs to nothing.
    const map = mapIdFromPath(`${folder}/${MAP_DAT_FILE}`) || DEFAULT_ROOT_NAME;
    entries.push({ folder, map, text });
  }
  return skeletonsOf(entries, options);
}

/** The skeleton of each of the pack's `maps`, named by the id the pipeline converts it under, as a
 *  campaign map's overlay must be. */
export function packMapSkeletons(maps: readonly PackMap[], options: SkeletonLanguages): MapSkeleton[] {
  return skeletonsOf(
    maps.map((map) => ({ folder: map.folder, map: map.id, text: map.text })),
    options,
  );
}

/** The pack's maps `selected` names, by pipeline id or folder name, case-insensitively, in folder order;
 *  every map without a selection. Throws on a name no map has. */
export function selectPackMaps(
  maps: ReadonlyMap<string, readonly PackMap[]>,
  selected: readonly string[],
): PackMap[] {
  const all = [...maps.values()]
    .flat()
    .sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0));
  if (selected.length === 0) return all;
  const names = (map: PackMap): string[] => [map.id, map.folder.slice(map.folder.lastIndexOf('/') + 1)];
  const wanted = new Set(selected.map((name) => name.toLowerCase()));
  const unknown = [...wanted].filter(
    (name) => !all.some((map) => names(map).some((n) => n.toLowerCase() === name)),
  );
  if (unknown.length > 0) throw new Error(`no pack map named ${unknown.join(', ')}`);
  return all.filter((map) => names(map).some((name) => wanted.has(name.toLowerCase())));
}

const UNRAR_WASM = 'node-unrar-js/esm/js/unrar.wasm';

/** The unrar binary `openArchive` needs for a RAR. */
async function unrarWasm(): Promise<ArrayBuffer> {
  const bytes = await readFile(createRequire(import.meta.url).resolve(UNRAR_WASM));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** A map archive (`.zip`, `.rar`, `.c2m`, `.tar`) or folder as a tree, and the name a root map takes. */
export async function readMapInput(path: string): Promise<{ tree: MapTree; rootName: string }> {
  const name = basename(path);
  if ((await stat(path)).isDirectory()) {
    const files = (await readdir(path, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => relative(path, join(entry.parentPath, entry.name)).split(sep).join('/'))
      .filter((rel) => isMapTextFile(rel.toLowerCase()))
      .sort();
    return { tree: await treeFromFolder(files, (rel) => readFile(join(path, rel))), rootName: name };
  }
  const tree = await openArchive(await readFile(path), { name, unrarWasm });
  return { tree, rootName: name.slice(0, name.length - extname(name).length) || DEFAULT_ROOT_NAME };
}

const isFile = (path: string): Promise<boolean> =>
  stat(path).then(
    (found) => found.isFile(),
    () => false,
  );

/** What an overlay's file name holds before the skeleton is written. */
type ExistingFile =
  | { readonly kind: 'absent' }
  | { readonly kind: 'overlay'; readonly overlay: MapOverlay }
  | { readonly kind: 'unreadable' };

async function existingFile(path: string): Promise<ExistingFile> {
  if (!(await isFile(path))) return { kind: 'absent' };
  try {
    return { kind: 'overlay', overlay: await readOverlayFile('maps', path) };
  } catch {
    return { kind: 'unreadable' };
  }
}

/** Where `writeMapOverlay` put an overlay, or would have. */
export interface WrittenOverlay {
  readonly file: string;
  /** `exists`: the file holds an overlay of the same basis text, which only `force` replaces.
   *  `protected`: it holds other text or no readable overlay, and is never replaced. */
  readonly outcome: 'written' | 'exists' | 'protected';
  /** The file carries the basis prefix: the plain file holds other text, or the variant exists already. */
  readonly variant: boolean;
}

/**
 * Writes `overlay` to `<out>/<lang>/maps/<map>.<digest prefix>.json`, or to the variant name that adds
 * its basis prefix when that variant exists already or the plain file holds other text. The name cannot
 * tell an older text of this map from a copy sharing its alias, so a translated file of other text is
 * never replaced; `force` replaces only a file of the same basis digest.
 */
export async function writeMapOverlay(
  out: string,
  lang: Language,
  digest: string,
  overlay: MapOverlay,
  force: boolean,
): Promise<WrittenOverlay> {
  const dir = join(out, lang, 'maps');
  const plainFile = join(dir, `${mapOverlayFileId(overlay.map, digest)}.json`);
  const variantFile = join(dir, `${mapOverlayFileId(overlay.map, digest, overlay.basis.digest)}.json`);
  const plain = await existingFile(plainFile);
  const plainHoldsOtherText = plain.kind === 'overlay' && plain.overlay.basis.digest !== overlay.basis.digest;
  const variant = plainHoldsOtherText || (await isFile(variantFile));
  const file = variant ? variantFile : plainFile;
  const existing = variant ? await existingFile(variantFile) : plain;
  const placed = { file, variant };
  if (
    existing.kind === 'unreadable' ||
    (existing.kind === 'overlay' && existing.overlay.basis.digest !== overlay.basis.digest)
  )
    return { ...placed, outcome: 'protected' };
  if (existing.kind === 'overlay' && !force) return { ...placed, outcome: 'exists' };
  await mkdir(dir, { recursive: true });
  await writeFile(file, `${JSON.stringify(overlay, null, 2)}\n`, {
    flag: existing.kind === 'absent' ? 'wx' : 'w',
  });
  return { ...placed, outcome: 'written' };
}

const USAGE =
  'usage: translations:skeleton <map archive or folder> --lang <language> [--basis <source language>] ' +
  '[--out <translations dir>] [--force]\n' +
  '       translations:skeleton --pack <unpacked data pack> [<map id or folder name>...] --lang <language> ' +
  '[--basis <source language>] [--out <translations dir>] [--force]';

function entryCount(overlay: MapOverlay): string {
  const strings = Object.keys(overlay.strings).length;
  const blocks = Object.keys(overlay.briefings).length;
  return `${strings} string(s) and ${blocks} briefing block(s)`;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      lang: { type: 'string' },
      basis: { type: 'string' },
      out: { type: 'string' },
      pack: { type: 'string' },
      force: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const [input, ...extra] = positionals;
  if (values.lang === undefined || (values.pack === undefined && (input === undefined || extra.length > 0)))
    throw new Error(USAGE);
  const lang = values.lang;
  if (!isLanguage(lang)) throw new Error(`--lang ${lang}: expected one of ${LANGUAGES.join(', ')}`);
  const basis = values.basis;
  if (basis !== undefined && !isSourceLanguage(basis))
    throw new Error(`--basis ${basis}: expected one of ${SOURCE_LANGUAGES.join(', ')}`);
  // npm runs a workspace script inside the workspace; INIT_CWD is where it was invoked.
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const out = values.out === undefined ? TRANSLATIONS_ROOT : resolve(baseDir, values.out);
  const languages = { lang, ...(basis === undefined ? {} : { basis }) };
  let skeletons: MapSkeleton[];
  if (values.pack !== undefined) {
    const pack = await readPackText(resolve(baseDir, values.pack));
    skeletons = packMapSkeletons(selectPackMaps(await pack.maps(), positionals), languages);
  } else {
    if (input === undefined) throw new Error(USAGE);
    const { tree, rootName } = await readMapInput(resolve(baseDir, input));
    skeletons = await mapSkeletons(tree, { ...languages, rootName });
    if (skeletons.length === 0) throw new Error(`${input}: no map folder, no ${MAP_DAT_FILE} found`);
  }
  for (const skeleton of skeletons) {
    if (skeleton.kind === 'shared') {
      console.log(
        `${skeleton.folder}: the same map.dat and text as ${skeleton.sharesWith}, whose overlay serves both`,
      );
      continue;
    }
    if (skeleton.kind === 'refused') {
      console.error(`${skeleton.folder}: refused, ${skeleton.refusal}`);
      process.exitCode = 1;
      continue;
    }
    const { folder, digest, overlay } = skeleton;
    const { file, outcome, variant } = await writeMapOverlay(out, lang, digest, overlay, values.force);
    if (outcome !== 'written') {
      console.error(
        outcome === 'exists'
          ? `${folder}: refused, ${file} holds an overlay of this text already; --force replaces it`
          : `${folder}: refused, ${file} holds no readable overlay of this text and is never replaced`,
      );
      process.exitCode = 1;
      continue;
    }
    const what =
      overlay.basis.lang === lang
        ? `an edit template of the ${lang} text: edit the values to change and delete the rest`
        : `a skeleton for ${lang} from the ${overlay.basis.lang} text: replace each value with its translation, delete the rest`;
    const name = variant
      ? ', a variant: the plain name holds an overlay of other text of this map; if that is its older ' +
        'text, carry its translations over and delete it'
      : '';
    console.log(`${folder}: wrote ${file}${name}, ${entryCount(overlay)}; ${what}`);
  }
}

// Runs only as the entry point, not when a test imports this module.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
