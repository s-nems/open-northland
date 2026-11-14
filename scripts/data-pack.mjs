import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DATA_PACK_VERSION = 5;
export const DATA_PACK_FORMAT = 'open-northland-data';
/** The languages the pack ships text in (the engine's `PACK_LANGUAGES`), spelled as the original's
 *  `text/<language>/` folders. */
const LANGUAGES = ['pol', 'eng', 'ger', 'rus', 'ita'];
const CAMPAIGN_VERSION = 2;
const MAP_ID = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
/** Served as `/campaigns/<id>/<path>`, so lower-case like the app's campaign asset URLs. */
const PRESENTATION_FILE = /^presentation\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\.png$/;
const FILM_FILE = /^films\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\.webm$/;
const SHARED_DIRS = ['world/', 'mission/'];
/** The per-language map folders; a shared file may not sit in one, so languages never collide. */
const LANGUAGE_DIRS = ['text', 'sfx'];
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;

function object(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label}: expected object`);
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error(`${label}: unknown field`);
  return value;
}

export function dataPath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    [...value].some((char) => char.charCodeAt(0) < 32) ||
    value.split('/').some((part) => !part || part === '.' || part === '..' || /[\\:]/.test(part))
  )
    throw new Error(`Invalid data path: ${String(value)}`);
  return value;
}

function id(value) {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error(`Invalid data id: ${String(value)}`);
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label}: expected array`);
  return value;
}

function unique(values, label) {
  if (new Set(values.map((v) => v.toLowerCase())).size !== values.length)
    throw new Error(`${label}: duplicate or case-colliding entry`);
}

export function parseDataManifest(value) {
  const manifest = object(
    value,
    ['format', 'version', 'base', 'components', 'campaigns', 'files'],
    'data manifest',
  );
  if (
    manifest.format !== DATA_PACK_FORMAT ||
    manifest.version !== DATA_PACK_VERSION ||
    manifest.base !== 'base'
  )
    throw new Error('Unsupported data manifest format, version or base');
  const components = array(manifest.components, 'components');
  for (const entry of components) {
    object(entry, ['id', 'kind', 'sha256'], 'component');
    id(entry.id);
    if (!['base', 'animation'].includes(entry.kind) || !SHA256.test(entry.sha256))
      throw new Error(`Invalid component ${entry.id}`);
  }
  unique(
    components.map((entry) => entry.id),
    'components',
  );
  if (components.filter((entry) => entry.kind === 'base').length !== 1)
    throw new Error('Data pack must contain exactly one base component');
  const campaigns = array(manifest.campaigns, 'campaigns').map(id);
  unique(campaigns, 'campaigns');
  const files = array(manifest.files, 'files');
  for (const entry of files) {
    object(entry, ['path', 'size', 'sha256'], 'file');
    dataPath(entry.path);
    if (
      !(entry.path.startsWith('base/') || campaigns.some((c) => entry.path.startsWith(`campaigns/${c}/`))) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      !SHA256.test(entry.sha256)
    )
      throw new Error(`Invalid data file ${entry.path}`);
  }
  unique(
    files.map((entry) => entry.path),
    'files',
  );
  return manifest;
}

export async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function inventory(root, prefix = '') {
  const files = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix + entry.name;
    dataPath(path);
    if (entry.isDirectory()) files.push(...(await inventory(root, `${path}/`)));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Data pack contains a non-regular file: ${path}`);
  }
  return files;
}

/** Validates the complete input, including cached trees, before conversion can remove old output. */
export async function readDataPack(root) {
  const manifest = parseDataManifest(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')));
  const paths = await inventory(root);
  const expected = new Set(['manifest.json', ...manifest.files.map((entry) => entry.path)]);
  if (paths.length !== expected.size || paths.some((path) => !expected.has(path)))
    throw new Error('Data pack inventory differs from manifest');
  for (const entry of manifest.files) {
    const path = join(root, entry.path);
    if ((await lstat(path)).size !== entry.size || (await sha256File(path)) !== entry.sha256)
      throw new Error(`Data file checksum mismatch: ${entry.path}`);
  }
  if (!(await lstat(join(root, 'base', 'rules'))).isDirectory())
    throw new Error('Data pack lacks base/rules');
  await readCampaigns(root, manifest);
  return manifest;
}

function integer(value, label, min = Number.MIN_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min) throw new Error(`${label}: expected an integer`);
  return value;
}

function fraction(value, label, { positive = false } = {}) {
  if (typeof value !== 'number' || !(positive ? value > 0 : value >= 0) || value > 1)
    throw new Error(`${label}: expected a fraction of the background`);
  return value;
}

function language(value, label) {
  if (!LANGUAGES.includes(value)) throw new Error(`${label}: unsupported language ${String(value)}`);
  return value;
}

/** A record keyed by language; `read` checks each value. */
function byLanguage(value, label, read, { optional = false } = {}) {
  object(value, LANGUAGES, label);
  const entries = Object.entries(value).map(([lang, entry]) => [
    language(lang, label),
    read(entry, `${label}.${lang}`),
  ]);
  if (entries.length === 0 && !optional) throw new Error(`${label}: expected at least one language`);
  return Object.fromEntries(entries);
}

function campaignFile(value, pattern, label, prefix, available) {
  if (typeof value !== 'string' || !pattern.test(value))
    throw new Error(`${label}: invalid file ${String(value)}`);
  if (!available.has(`${prefix}/${value}`)) throw new Error(`Missing campaign file: ${prefix}/${value}`);
  return value;
}

function fileMapping(value, prefix, available, label) {
  object(value, Object.keys(value ?? {}), label);
  unique(Object.keys(value), label);
  for (const [logical, source] of Object.entries(value)) {
    dataPath(logical);
    dataPath(source);
    if (!available.has(`${prefix}/${source}`)) throw new Error(`Missing campaign file: ${prefix}/${source}`);
  }
  return value;
}

const inLanguageDir = (logical, lang) =>
  LANGUAGE_DIRS.some((dir) => logical.toLowerCase().startsWith(`${dir}/${lang}/`));

function readMap(map, prefix, available) {
  object(map, ['id', 'shared', 'locales'], 'campaign map');
  if (typeof map.id !== 'string' || !MAP_ID.test(map.id))
    throw new Error(`Invalid campaign map id: ${String(map.id)}`);
  const mapPrefix = `${prefix}/maps/${map.id}`;
  const shared = fileMapping(map.shared, mapPrefix, available, `${map.id} shared files`);
  for (const [logical, source] of Object.entries(shared)) {
    if (!SHARED_DIRS.some((dir) => source.startsWith(dir)))
      throw new Error(`${map.id}: shared file outside ${SHARED_DIRS.join(' or ')}: ${source}`);
    if (LANGUAGES.some((lang) => inLanguageDir(logical, lang)))
      throw new Error(`${map.id}: shared file in a language folder: ${logical}`);
  }
  const locales = byLanguage(map.locales, `${map.id} locales`, (files) => files);
  for (const [lang, files] of Object.entries(locales)) {
    fileMapping(files, mapPrefix, available, `${map.id} ${lang} files`);
    for (const [logical, source] of Object.entries(files)) {
      if (!inLanguageDir(logical, lang))
        throw new Error(`${map.id}: ${lang} file outside its language folders: ${logical}`);
      if (!source.startsWith(`locales/${lang}/`))
        throw new Error(`${map.id}: ${lang} file outside locales/${lang}/`);
    }
  }
  return { id: map.id, shared, locales };
}

function readRoute(route, label, prefix, available) {
  object(route, ['file', 'x', 'y', 'width', 'height'], label);
  return {
    file: campaignFile(route.file, PRESENTATION_FILE, label, prefix, available),
    x: fraction(route.x, `${label}.x`),
    y: fraction(route.y, `${label}.y`),
    width: fraction(route.width, `${label}.width`, { positive: true }),
    height: fraction(route.height, `${label}.height`, { positive: true }),
  };
}

function readFilm(film, label, prefix, available, keys = ['video', 'audio', 'width', 'height']) {
  object(film, keys, label);
  return {
    video: campaignFile(film.video, FILM_FILE, `${label}.video`, prefix, available),
    audio: campaignFile(film.audio, FILM_FILE, `${label}.audio`, prefix, available),
    width: integer(film.width, `${label}.width`, 1),
    height: integer(film.height, `${label}.height`, 1),
  };
}

/** Validates one `campaigns/<id>/campaign.json` against the pack inventory. */
async function readCampaign(root, campaignId, available) {
  const prefix = `campaigns/${id(campaignId)}`;
  const keys = [
    'version',
    'id',
    'campaignId',
    'order',
    'title',
    'background',
    'logo',
    'stages',
    'movies',
    'maps',
  ];
  const campaign = object(
    JSON.parse(await readFile(join(root, prefix, 'campaign.json'), 'utf8')),
    keys,
    'campaign',
  );
  if (campaign.version !== CAMPAIGN_VERSION || campaign.id !== campaignId)
    throw new Error(`Unsupported campaign identity or version: ${campaignId}`);
  const maps = array(campaign.maps, 'campaign maps').map((map) => readMap(map, prefix, available));
  if (maps.length === 0) throw new Error(`${campaignId}: no maps`);
  unique(
    maps.map((map) => map.id),
    'campaign maps',
  );
  const languages = Object.keys(maps[0].locales);
  for (const map of maps)
    if (Object.keys(map.locales).join() !== languages.join())
      throw new Error(`${campaignId}: map ${map.id} carries other languages than ${maps[0].id}`);
  const stages = array(campaign.stages, 'campaign stages').map((stage, index) => {
    const label = `${campaignId} stage ${index}`;
    object(stage, ['missionId', 'x', 'y', 'route'], label);
    return {
      missionId: integer(stage.missionId, `${label}.missionId`, 0),
      x: fraction(stage.x, `${label}.x`),
      y: fraction(stage.y, `${label}.y`),
      ...(stage.route === undefined
        ? {}
        : { route: readRoute(stage.route, `${label}.route`, prefix, available) }),
    };
  });
  if (stages.length === 0) throw new Error(`${campaignId}: no stages`);
  // A language without its own films is left out; the app then plays another language's.
  const movies = byLanguage(
    campaign.movies,
    `${campaignId} movies`,
    (films, label) => {
      object(films, ['intro', 'videos'], label);
      return {
        ...(films.intro === undefined
          ? {}
          : { intro: readFilm(films.intro, `${label}.intro`, prefix, available) }),
        videos: array(films.videos, `${label}.videos`).map((video, index) => ({
          sequence: integer(video.sequence, `${label}.videos[${index}].sequence`, 0),
          ...readFilm(video, `${label}.videos[${index}]`, prefix, available, [
            'sequence',
            'video',
            'audio',
            'width',
            'height',
          ]),
        })),
      };
    },
    { optional: true },
  );
  return {
    id: campaignId,
    campaignId: integer(campaign.campaignId, `${campaignId}.campaignId`, 0),
    order: integer(campaign.order, `${campaignId}.order`),
    title: byLanguage(campaign.title, `${campaignId} title`, (text, label) => {
      if (typeof text !== 'string' || text.trim() === '') throw new Error(`${label}: expected text`);
      return text;
    }),
    languages,
    background: campaignFile(
      campaign.background,
      PRESENTATION_FILE,
      `${campaignId}.background`,
      prefix,
      available,
    ),
    ...(campaign.logo === undefined
      ? {}
      : {
          logo: byLanguage(campaign.logo, `${campaignId} logo`, (file, label) =>
            campaignFile(file, PRESENTATION_FILE, label, prefix, available),
          ),
        }),
    stages,
    movies,
    maps,
  };
}

/** The validated campaign sources of a pack whose files the manifest already lists. */
export async function readCampaigns(root, manifest) {
  const available = new Set(manifest.files.map((entry) => entry.path));
  const campaigns = [];
  for (const campaignId of manifest.campaigns)
    campaigns.push(await readCampaign(root, campaignId, available));
  return campaigns;
}
