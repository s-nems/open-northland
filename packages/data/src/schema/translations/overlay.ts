import { z } from 'zod';
import { jsonFingerprint } from '../../fingerprint/json.js';
import { LANGUAGES, SOURCE_LANGUAGES } from '../../languages.js';
import { PersonalNamePoolId } from '../actors/personal-names.js';

/**
 * The repository's translation overlays, `translations/<lang>/...`: text the data pack and the
 * catalogue archives do not carry. An overlay entry replaces the source entry of the same key. A string
 * the overlay lacks keeps the source's text in the overlay's language, else is read along
 * `textReadingOrder`; a briefing or book block it lacks keeps the block of the pages it renders into,
 * the basis language's when the source ships them. Overlays are UTF-8 JSON validated by these schemas
 * before any stage reads them.
 */
export const OVERLAY_VERSION = 1;

/** A SHA-256 hex digest. */
const Digest = z.string().regex(/^[0-9a-f]{64}$/);
/** A string id or type id as its decimal key, without leading zeros, so it names the id it parses to. */
const IdKey = z.string().regex(/^(0|[1-9]\d*)$/);

/**
 * The source text the overlay was written against: the language it translates or edits, and the
 * digest of that language's decoded text as the pack shipped it. A later source change under an
 * unchanged overlay is reported by the translations audit, never silently masked nor a build failure.
 */
export const OverlayBasis = z.strictObject({
  lang: z.enum(SOURCE_LANGUAGES),
  digest: Digest,
});
export type OverlayBasis = z.infer<typeof OverlayBasis>;

/** How many leading hex digits of the raw `map.dat` SHA-256 a map overlay's file name carries: 64 bits,
 *  which tell apart the maps of the pack and the catalogue without the full digest's length. */
export const MAP_OVERLAY_DAT_PREFIX_LENGTH = 16;
/** How many leading hex digits of `basis.digest` a further map overlay's file name carries. */
export const MAP_OVERLAY_BASIS_PREFIX_LENGTH = 12;
/** The `map` alias as a file name part: a map id slug. */
const MapAlias = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/);
const MAP_OVERLAY_FILE_ID = new RegExp(
  `^([a-z0-9][a-z0-9_-]*)\\.([0-9a-f]{${MAP_OVERLAY_DAT_PREFIX_LENGTH}})` +
    `(?:\\.([0-9a-f]{${MAP_OVERLAY_BASIS_PREFIX_LENGTH}}))?$`,
);

/** A map overlay's file name without `.json`, split into the `map` alias, the `map.dat` prefix that files
 *  it and the basis prefix a further overlay of that `map.dat` carries. */
export interface MapOverlayFileId {
  readonly map: string;
  readonly datKey: string;
  readonly basisPrefix: string | undefined;
}

/** The key map overlays are filed under: the prefix of the raw `map.dat` SHA-256 their names carry. */
export function mapOverlayDatKey(datDigest: string): string {
  return datDigest.slice(0, MAP_OVERLAY_DAT_PREFIX_LENGTH);
}

/** The parts of map overlay file name `id` (without `.json`), or undefined when it has neither form. */
export function parseMapOverlayFileId(id: string): MapOverlayFileId | undefined {
  const match = MAP_OVERLAY_FILE_ID.exec(id);
  const map = match?.[1];
  const datKey = match?.[2];
  return map === undefined || datKey === undefined ? undefined : { map, datKey, basisPrefix: match?.[3] };
}

/** The file name without `.json` of the overlay of map `map` with `datDigest`: a further one takes its
 *  basis prefix. */
export function mapOverlayFileId(map: string, datDigest: string, basisDigest?: string): string {
  const plain = `${map}.${mapOverlayDatKey(datDigest)}`;
  return basisDigest === undefined
    ? plain
    : `${plain}.${basisDigest.slice(0, MAP_OVERLAY_BASIS_PREFIX_LENGTH)}`;
}

/**
 * The suffix of a project edit over an imported overlay: `<name>.edit.json` beside `<name>.json` holds
 * the project's text for the keys the project's corrections or source-language edits changed, since the
 * import translates the text as the pack shipped it. The loader attaches it to the overlay of `<name>`.
 */
export const OVERLAY_EDIT_SUFFIX = '.edit';

/** File id `id` (without `.json`) split into the overlay it names and whether it is that overlay's edit. */
export function splitOverlayEdit(id: string): { readonly name: string; readonly edit: boolean } {
  return id.endsWith(OVERLAY_EDIT_SUFFIX)
    ? { name: id.slice(0, -OVERLAY_EDIT_SUFFIX.length), edit: true }
    : { name: id, edit: false };
}

/** A filed map overlay with the project's edit over it, when `<name>.edit.json` exists. */
export interface FiledMapOverlay extends MapOverlay {
  readonly edit?: MapOverlay;
}

/**
 * `translations/<lang>/maps/<map>.<map.dat prefix>.json`: one map's strings by id and briefing blocks by
 * label. `<map>` is the overlay's `map` alias and `<map.dat prefix>` the first hex digits of the raw
 * `map.dat` SHA-256, which identify the file. A further overlay of the same `map.dat` and language, for a
 * copy of the map with other text, adds `.<first hex digits of basis.digest>` before `.json`.
 */
export const MapOverlay = z.strictObject({
  version: z.literal(OVERLAY_VERSION),
  /** The map id the overlay was written for, which its file name repeats. */
  map: MapAlias,
  basis: OverlayBasis,
  strings: z.record(IdKey, z.string()).default({}),
  /** `briefings.txt` block bodies by label, with the tags a block body carries (`<picture:…>` and so on). */
  briefings: z.record(z.string().min(1), z.string()).default({}),
  /** Set on a file a tool converted from the named language's overlay of the same name (Traditional
   *  from Simplified Chinese); the tool rewrites it and nobody edits it by hand. */
  derived: z.enum(LANGUAGES).optional(),
});
export type MapOverlay = z.infer<typeof MapOverlay>;

/**
 * `translations/<lang>/objects/<table>.json`: one game-object name table (`goods`, `houses`, `jobs`,
 * `experiences`, `tribes`) by type id, with the plural where the table has one.
 */
export const ObjectTableOverlay = z.strictObject({
  version: z.literal(OVERLAY_VERSION),
  basis: OverlayBasis,
  names: z.record(IdKey, z.string()),
  plurals: z.record(IdKey, z.string()).default({}),
  /** As on `MapOverlay`: set on a file a tool converted from the named language's file of the same name. */
  derived: z.enum(LANGUAGES).optional(),
});
export type ObjectTableOverlay = z.infer<typeof ObjectTableOverlay>;

/** A filed object table overlay with the project's edit over it, when `<table>.edit.json` exists. */
export interface FiledObjectTableOverlay extends ObjectTableOverlay {
  readonly edit?: ObjectTableOverlay;
}

/** An object table overlay's `basis.digest`: the decoded source names and plurals by type id, as the pack
 *  shipped them, not normalised. */
export function objectTableSourceDigest({
  names,
  plurals,
}: {
  readonly names: Readonly<Record<number, string>>;
  readonly plurals: Readonly<Record<number, string>>;
}): string {
  return jsonFingerprint({ names: { ...names }, plurals: { ...plurals } });
}

/**
 * `translations/<lang>/books/<book>.json`: a hypertext book's block bodies, by block file then label
 * (`history.txt`, `mythology.txt`); the pages come from the basis language.
 */
export const BookOverlay = z.strictObject({
  version: z.literal(OVERLAY_VERSION),
  basis: OverlayBasis,
  blocks: z.record(z.string().min(1), z.record(z.string().min(1), z.string())),
});
export type BookOverlay = z.infer<typeof BookOverlay>;

/** `translations/<lang>/campaigns/<campaign-id>.json`: the campaign screen's title. */
export const CampaignOverlay = z.strictObject({
  version: z.literal(OVERLAY_VERSION),
  title: z.string().min(1),
});
export type CampaignOverlay = z.infer<typeof CampaignOverlay>;

/**
 * `translations/<lang>/names/<pool>.json`: one personal-name pool's localized names, by the raw spelling
 * the pool gives the settler. `<pool>` is the pool id of `PERSONAL_NAMES`, which the overlay's `pool`
 * field repeats; a name the overlay lacks keeps the raw one. The raw name is the lockstep sync key, so
 * this dictionary is display-only data that no system reads. It carries no `basis`: the pools are the
 * project's own independently selected names, not text the pack ships, so there is no source-language
 * text a digest could pin it to.
 */
export const PersonalNameOverlay = z.strictObject({
  version: z.literal(OVERLAY_VERSION),
  /** The personal-name pool the overlay translates, which its file name repeats. */
  pool: PersonalNamePoolId,
  names: z.record(z.string().min(1), z.string().min(1)),
  /** As on `MapOverlay`: set on a file a tool converted from the named language's file of the same name. */
  derived: z.enum(LANGUAGES).optional(),
});
export type PersonalNameOverlay = z.infer<typeof PersonalNameOverlay>;
