import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Campaign,
  CampaignIndex,
  isSourceLanguage,
  LANGUAGES,
  type LocalizedText,
  type MapTextLanguage,
  OVERLAY_LANGUAGES,
  PACK_LANGUAGES,
} from '@open-northland/data';
import {
  type ConvertedMap,
  convertMapFolder,
  findMapFolders,
  type MapDatTerrainFile,
  type MapTree,
  mapFiles,
  NO_IMPORT_LIMITS,
  treeFromFolder,
} from '@open-northland/map-import';
import type { CampaignFilmSource, CampaignSource } from '../../../../scripts/data-pack.mjs';
import { writeFileWithParents } from '../files.js';
import { readSourceFile, type SourceRoots } from '../roots.js';
import { correctMapStrings } from '../string-corrections.js';
import { MAPS_DIR } from './content-tree.js';
import { writePagePictures } from './hypertext-pictures.js';
import { withAuthoredForm } from './maps/authored-form.js';
import { type MapDatConversion, mapOverlaySource, summarizeConversion } from './maps/index.js';

/** Served at `/campaigns/<id>/`, the root `campaigns-index.json` names its pictures and films under. */
export const CAMPAIGNS_DIR = 'campaigns';
const CAMPAIGN_INDEX_VERSION = 3;

/** Where the pack keeps its campaigns, beside the base tree. */
const PACK_CAMPAIGNS_DIR = 'campaigns';

export interface CampaignStageResult {
  readonly maps: readonly MapDatConversion[];
  readonly index: CampaignIndex;
}

/** A campaign map keeps its pack folder name under a campaign prefix, so two games' slots never collide. */
export function campaignMapId(campaignId: string, mapId: string): string {
  return `${campaignId}-${mapId}`;
}

/** One campaign map's files as a map tree, read through the corrections: its folder and the key the
 *  converter takes. */
export interface CampaignMapTree {
  readonly folder: string;
  readonly tree: MapTree;
  readonly key: string;
}

/** Reads one campaign map's shared files and every language layer into one map folder; `include`
 *  narrows the lower-cased logical paths read. */
export async function readCampaignMapTree(
  roots: SourceRoots,
  packRoot: string,
  campaign: CampaignSource,
  map: CampaignSource['maps'][number],
  include: (path: string) => boolean = () => true,
): Promise<CampaignMapTree> {
  const folder = `${PACK_CAMPAIGNS_DIR}/${campaign.id}/${map.id}`;
  const mapDir = join(packRoot, PACK_CAMPAIGNS_DIR, campaign.id, 'maps', map.id);
  const sources = new Map<string, string>();
  for (const files of [map.shared, ...Object.values(map.locales)])
    for (const [logical, source] of Object.entries(files))
      if (include(`${folder}/${logical}`.toLowerCase())) sources.set(`${folder}/${logical}`, source);
  const tree = await treeFromFolder(
    sources.keys(),
    (rel) => readSourceFile(roots, join(mapDir, sources.get(rel) ?? rel), rel),
    NO_IMPORT_LIMITS,
  );
  const [key, ...others] = findMapFolders(tree);
  if (key === undefined || others.length > 0) throw new Error(`${folder}: expected exactly one map folder`);
  return { folder, tree, key };
}

/** Converts one map from its shared files and every language layer, all languages in one map. A
 *  source-language overlay is refused: campaign text keeps the corrections. */
async function convertCampaignMap(
  roots: SourceRoots,
  packRoot: string,
  campaign: CampaignSource,
  map: CampaignSource['maps'][number],
  synthesizeMinimap: ((terrain: MapDatTerrainFile) => Promise<Uint8Array | undefined>) | undefined,
): Promise<ConvertedMap> {
  const { folder, tree, key } = await readCampaignMapTree(roots, packRoot, campaign, map);
  const stringCorrections = roots.mapStringCorrections;
  const overlays = mapOverlaySource(roots, false);
  const converted = await convertMapFolder(tree, key, {
    id: campaignMapId(campaign.id, map.id),
    provenance: 'mod',
    limits: NO_IMPORT_LIMITS,
    ...(roots.corrections === undefined
      ? {}
      : {
          correctCifLines: roots.corrections.correctCifLines,
          correctObjects: roots.corrections.correctObjects,
          shippedFile: roots.corrections.shipped,
        }),
    ...(synthesizeMinimap === undefined ? {} : { minimap: synthesizeMinimap }),
    ...(stringCorrections === undefined
      ? {}
      : { correctStrings: (id, tables) => correctMapStrings(stringCorrections, id, tables) }),
    ...(overlays === undefined ? {} : { overlays }),
    onWarning: (message) => console.warn(`[pipeline] ${message}`),
  });
  if (converted.meta.campaign?.campaignId !== campaign.campaignId)
    throw new Error(
      `${folder}: map.cif names campaign ${converted.meta.campaign?.campaignId}, not ${campaign.campaignId}`,
    );
  return withAuthoredForm(converted);
}

/** Copies one pack file of the campaign into `campaigns/<id>/` and returns the URL the app fetches it at. */
async function publish(packRoot: string, outDir: string, campaignId: string, file: string): Promise<string> {
  const target = join(outDir, CAMPAIGNS_DIR, campaignId, file);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(packRoot, PACK_CAMPAIGNS_DIR, campaignId, file), target);
  return `/${CAMPAIGNS_DIR}/${campaignId}/${file}`;
}

/** The repository's authored subtitles, resolved from this stage file so any working directory works. */
const SUBTITLE_ROOT = fileURLToPath(new URL('../../../../translations/', import.meta.url));

/**
 * Publishes each authored `.srt` for a film slot from `translations/<lang>/campaigns/<id>/films/<slot>.srt`
 * into ignored `content/campaigns/<id>/films/<lang>/<slot>.srt`, returning the per-language URLs the
 * `Movie.subtitles` map records. A language without a file is omitted; a slot with none returns
 * undefined. The generated `campaigns-index.json` is not committed, so no subtitle text enters the repo.
 */
async function publishSubtitles(
  outDir: string,
  campaignId: string,
  slot: string,
): Promise<Partial<Record<MapTextLanguage, string>> | undefined> {
  const subtitles: Partial<Record<MapTextLanguage, string>> = {};
  for (const language of LANGUAGES) {
    const source = join(SUBTITLE_ROOT, language, 'campaigns', campaignId, 'films', `${slot}.srt`);
    try {
      await stat(source);
    } catch {
      continue;
    }
    const target = join(outDir, CAMPAIGNS_DIR, campaignId, 'films', language, `${slot}.srt`);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
    subtitles[language] = `/${CAMPAIGNS_DIR}/${campaignId}/films/${language}/${slot}.srt`;
  }
  return Object.keys(subtitles).length > 0 ? subtitles : undefined;
}

/** A stage's title is its map's name in the campaign's languages. */
function stageTitle(map: ConvertedMap, languages: readonly MapTextLanguage[]): LocalizedText {
  return Object.fromEntries(
    languages.flatMap((language) => {
      const name = map.index.name?.[language]?.trim();
      return name ? [[language, name]] : [];
    }),
  );
}

/**
 * The campaign's text languages: the pack's, then each overlay language every one of its maps took an
 * overlay in; a shipped language's overlays are redundant, never applied. A language only some maps
 * carry is left out with a warning, since a campaign plays in one language throughout.
 */
function campaignLanguages(campaign: CampaignSource, maps: readonly ConvertedMap[]): MapTextLanguage[] {
  const languages: MapTextLanguage[] = [...campaign.languages];
  for (const lang of OVERLAY_LANGUAGES) {
    const covered = maps.filter((map) =>
      map.overlays.some((outcome) => outcome.lang === lang && outcome.status === 'applied'),
    ).length;
    if (covered === maps.length) languages.push(lang);
    else if (covered > 0)
      console.warn(
        `[pipeline] campaign ${campaign.id}: ${lang} overlays cover ${covered} of ${maps.length} maps, ` +
          `so ${lang} is left out of its languages`,
      );
  }
  return languages;
}

/** The pack's title, with each overlay language's campaign overlay where the pack has no title in it. */
function campaignTitle(roots: SourceRoots, campaign: CampaignSource): LocalizedText {
  const title: LocalizedText = { ...campaign.title };
  for (const [lang, overlays] of roots.overlays?.campaigns ?? []) {
    const overlay = overlays.get(campaign.id);
    if (overlay === undefined) continue;
    if (isSourceLanguage(lang)) {
      console.warn(
        `[pipeline] campaign ${campaign.id}: refused ${lang} title overlay: source-language text belongs in corrections`,
      );
      continue;
    }
    if (title[lang] !== undefined) {
      console.warn(
        `[pipeline] campaign ${campaign.id}: skipped ${lang} title overlay: the pack ships the title`,
      );
      continue;
    }
    title[lang] = overlay.title;
  }
  return title;
}

async function convertCampaign(
  roots: SourceRoots,
  packRoot: string,
  outDir: string,
  campaign: CampaignSource,
  synthesizeMinimap: ((terrain: MapDatTerrainFile) => Promise<Uint8Array | undefined>) | undefined,
): Promise<{ readonly entry: Campaign; readonly maps: readonly ConvertedMap[] }> {
  const maps: ConvertedMap[] = [];
  for (const map of campaign.maps) {
    const converted = await convertCampaignMap(roots, packRoot, campaign, map, synthesizeMinimap);
    for (const [name, data] of mapFiles(converted))
      await writeFileWithParents(join(outDir, MAPS_DIR, name), data);
    await writePagePictures(outDir, converted.pictures);
    maps.push(converted);
  }
  const asset = (file: string): Promise<string> => publish(packRoot, outDir, campaign.id, file);
  const film = async (source: CampaignFilmSource, slot: string) => {
    const subtitles = await publishSubtitles(outDir, campaign.id, slot);
    return {
      url: await asset(source.video),
      audio: await asset(source.audio),
      width: source.width,
      height: source.height,
      ...(subtitles === undefined ? {} : { subtitles }),
    };
  };

  const languages = campaignLanguages(campaign, maps);
  const stages: Campaign['stages'][number][] = [];
  for (const stage of campaign.stages) {
    const map = maps.find((candidate) => candidate.meta.campaign?.missionId === stage.missionId);
    if (map === undefined) throw new Error(`${campaign.id}: no map for mission ${stage.missionId}`);
    const { route } = stage;
    stages.push({
      mapId: map.id,
      title: stageTitle(map, languages),
      x: stage.x,
      y: stage.y,
      ...(route === undefined
        ? {}
        : {
            route: {
              url: await asset(route.file),
              x: route.x,
              y: route.y,
              width: route.width,
              height: route.height,
            },
          }),
    });
  }
  const logo: Partial<Record<MapTextLanguage, string>> = {};
  const movies: Campaign['movies'] = {};
  // The pack ships presentation and films only in the languages its maps carry.
  for (const language of PACK_LANGUAGES) {
    const file = campaign.logo?.[language];
    if (file !== undefined) logo[language] = await asset(file);
    const films = campaign.movies[language];
    if (films === undefined) continue;
    movies[language] = {
      ...(films.intro === undefined ? {} : { intro: await film(films.intro, 'intro') }),
      videos: await Promise.all(
        films.videos.map(async (video) => ({
          ...(await film(video, `seq_${String(video.sequence).padStart(4, '0')}`)),
          sequence: video.sequence,
        })),
      ),
    };
  }
  return {
    entry: {
      id: campaign.id,
      campaignId: campaign.campaignId,
      order: campaign.order,
      title: campaignTitle(roots, campaign),
      languages,
      maps: maps.map((map) => {
        const missionId = map.meta.campaign?.missionId;
        if (missionId === undefined) throw new Error(`${map.id}: no mission slot`);
        return { id: map.id, missionId };
      }),
      stages,
      background: await asset(campaign.background),
      ...(Object.keys(logo).length === 0 ? {} : { logo }),
      movies,
    },
    maps,
  };
}

/**
 * Converts the pack's campaigns: their maps into `maps/` beside the base maps, their pictures and films
 * into `campaigns/<id>/`, and the index the campaign screen reads. A campaign map whose id a base map
 * already uses fails the run. This stage is the only writer under `campaigns/`.
 */
export async function convertCampaignStage(
  roots: SourceRoots,
  packRoot: string,
  campaigns: readonly CampaignSource[],
  outDir: string,
  baseMapIds: ReadonlySet<string>,
  synthesizeMinimap?: (terrain: MapDatTerrainFile) => Promise<Uint8Array | undefined>,
): Promise<CampaignStageResult> {
  await rm(join(outDir, CAMPAIGNS_DIR), { recursive: true, force: true });
  const entries: Campaign[] = [];
  const done: MapDatConversion[] = [];
  for (const campaign of campaigns) {
    for (const map of campaign.maps) {
      const id = campaignMapId(campaign.id, map.id);
      if (baseMapIds.has(id)) throw new Error(`campaign map ${id} collides with a base map`);
    }
    const { entry, maps } = await convertCampaign(roots, packRoot, outDir, campaign, synthesizeMinimap);
    entries.push(entry);
    done.push(...maps.map(summarizeConversion));
  }
  return { maps: done, index: CampaignIndex.parse({ version: CAMPAIGN_INDEX_VERSION, campaigns: entries }) };
}
