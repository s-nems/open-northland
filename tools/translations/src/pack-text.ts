import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  campaignMapId,
  GAME_OBJECT_TABLES,
  type GameObjectNames,
  type GameObjectTable,
  historyDir,
  isObjectHelpTable,
  OBJECT_HELP_TABLES,
  type ObjectHelpTable,
  readBaseMapTree,
  readCampaignMapTree,
  readGameObjectNames,
  readHistoryBlocks,
  readObjectHelp,
  type SourceRoots,
  takesSourceLanguageOverlays,
} from '@open-northland/asset-pipeline/sources';
import { jsonFingerprint, mapOverlayDatKey, type SourceLanguage } from '@open-northland/data';

export { objectTableSourceDigest } from '@open-northland/data';

import { textEncoding } from '@open-northland/formats/text-encoding';
import {
  findMapFolders,
  isMapTextFile,
  MAP_DAT_FILE,
  type MapSourceText,
  type MapTree,
  mapIdFromPath,
  readMapSourceText,
} from '@open-northland/map-import';
import { type CampaignSource, parseDataManifest, readCampaigns } from '../../../scripts/data-pack.mjs';

/** The tables `translations/<lang>/objects/` holds: the name tables and the description tables. */
export type ObjectOverlayTable = GameObjectTable | ObjectHelpTable;
export const OBJECT_OVERLAY_TABLES: readonly ObjectOverlayTable[] = [
  ...GAME_OBJECT_TABLES,
  ...OBJECT_HELP_TABLES,
];
export const isObjectOverlayTable = (name: string): name is ObjectOverlayTable =>
  (OBJECT_OVERLAY_TABLES as readonly string[]).includes(name);

/** One map of the pack and the text it ships. */
export interface PackMap {
  /** The lower-cased folder of a base map, or `campaigns/<campaign>/<map>`. */
  readonly folder: string;
  /** The id the pipeline converts the map under. */
  readonly id: string;
  /** The campaign the map belongs to, for a campaign map. */
  readonly campaign?: string;
  /** Whether the pipeline applies a source-language overlay to it: a community map only. */
  readonly takesSourceLanguages: boolean;
  /** The raw `map.dat` MD5 hex digest, which CulturesGameLocalization names a map by. */
  readonly datMd5: string;
  readonly text: MapSourceText;
}

/** A history book's blocks by lower-cased block file, then label. */
export type BookBlocks = ReadonlyMap<string, ReadonlyMap<string, string>>;

/** The pack's source text as it shipped, read with the pipeline's readers but without its corrections:
 *  an overlay's basis is the shipped text. */
export interface PackText {
  /** Every base and campaign map, by `mapOverlayDatKey` of its raw `map.dat` SHA-256, the key its
   *  overlays are filed under; one key can name several copies. Read on the first call, since it walks
   *  the whole pack. */
  maps(): Promise<ReadonlyMap<string, readonly PackMap[]>>;
  readonly campaigns: ReadonlySet<string>;
  /** One language's game-object or description table; throws when the pack lacks it or it does not
   *  decode. */
  objectNames(lang: SourceLanguage, table: ObjectOverlayTable): Promise<GameObjectNames>;
  /** One language's history book, or undefined when the pack lacks it. */
  historyBlocks(lang: SourceLanguage): Promise<BookBlocks | undefined>;
}

/** A book overlay's `basis.digest`: the basis language's blocks by lower-cased block file, then label. */
export function bookSourceDigest(blocks: BookBlocks): string {
  return jsonFingerprint({
    blocks: Object.fromEntries([...blocks].map(([file, labels]) => [file, Object.fromEntries(labels)])),
  });
}

function addMap(maps: Map<string, PackMap[]>, map: PackMap): void {
  const key = mapOverlayDatKey(map.text.datDigest);
  const copies = maps.get(key) ?? [];
  copies.push(map);
  maps.set(key, copies);
}

/** The spelled path of folder `key`'s `map.dat`, which names the map, and its MD5; undefined without one. */
function mapDat(tree: MapTree, key: string): { readonly path: string; readonly md5: string } | undefined {
  const dat = key === '' ? MAP_DAT_FILE : `${key}/${MAP_DAT_FILE}`;
  const bytes = tree.files.get(dat);
  if (bytes === undefined) return undefined;
  return { path: tree.names.get(dat) ?? dat, md5: createHash('md5').update(bytes).digest('hex') };
}

/** The text of every base and campaign map; only map.dat and the text files are read. */
async function readPackMaps(
  roots: SourceRoots,
  dataRoot: string,
  campaigns: readonly CampaignSource[],
): Promise<Map<string, PackMap[]>> {
  const maps = new Map<string, PackMap[]>();
  const tree = await readBaseMapTree(roots, isMapTextFile);
  for (const key of findMapFolders(tree)) {
    const text = await readMapSourceText(tree, key);
    const dat = mapDat(tree, key);
    if (text === undefined || dat === undefined) continue;
    addMap(maps, {
      folder: key,
      id: mapIdFromPath(dat.path),
      takesSourceLanguages: takesSourceLanguageOverlays(key),
      datMd5: dat.md5,
      text,
    });
  }
  for (const campaign of campaigns) {
    for (const map of campaign.maps) {
      const read = await readCampaignMapTree(roots, dataRoot, campaign, map, isMapTextFile);
      const text = await readMapSourceText(read.tree, read.key);
      const dat = mapDat(read.tree, read.key);
      if (text === undefined || dat === undefined) continue;
      addMap(maps, {
        folder: read.folder,
        id: campaignMapId(campaign.id, map.id),
        campaign: campaign.id,
        takesSourceLanguages: false,
        datMd5: dat.md5,
        text,
      });
    }
  }
  return maps;
}

/**
 * Reads the unpacked pack at `dataRoot`. The manifest and campaigns are parsed, not checksummed: the
 * pipeline validates the pack before it converts it.
 */
export async function readPackText(dataRoot: string): Promise<PackText> {
  const manifest = parseDataManifest(JSON.parse(await readFile(join(dataRoot, 'manifest.json'), 'utf8')));
  const roots: SourceRoots = { data: join(dataRoot, 'base') };
  const campaigns = await readCampaigns(dataRoot, manifest);
  let maps: Promise<Map<string, PackMap[]>> | undefined;
  return {
    maps: () => {
      maps ??= readPackMaps(roots, dataRoot, campaigns);
      return maps;
    },
    campaigns: new Set(campaigns.map((campaign) => campaign.id)),
    objectNames: (lang, table) =>
      isObjectHelpTable(table) ? readObjectHelp(roots, lang, table) : readGameObjectNames(roots, lang, table),
    historyBlocks: async (lang) => {
      const dir = await historyDir(roots, lang);
      return dir === undefined ? undefined : readHistoryBlocks(dir, textEncoding(lang));
    },
  };
}
