/**
 * Map metadata and decoded static-object placements from a map `.cif`.
 */
import { MapInfo } from '@open-northland/data';
import { findProp, getInt, makeSource, type RuleSection, type SourceRef } from './grammar.js';

/**
 * Reduces one decoded `map.cif`'s logic header sections into a validated {@link MapInfo}. The map's
 * `CStringArray` opens with a `logiccontrol` section (`mapsize <w> <h>`, `mapguid <16 bytes>`) plus
 * `misc_maptype`/`misc_mapname` metadata sections; this pulls those declarative scalars only —
 * `StaticObjects` is {@link extractStaticObjects}'s slice, and `playerdata`/`playermisc`/
 * `MissionData` are `extractMapScript`'s (`./map-script.ts`). `id` is supplied by
 * the caller (the map folder name), since the header carries no human-readable map id.
 *
 * Throws when the required `logiccontrol` `mapsize`/`mapguid` are absent or malformed — a `map.cif`
 * without them is not a decodable map, surfaced to the human running the offline pipeline rather than
 * emitting a degenerate record (matches the throw-on-malformed stance of the other required-field
 * extractors). The optional `misc_*` scalars are simply omitted when a given map lacks them (skirmish
 * maps have no `mapcampaignid`, for instance).
 */
export function extractMapInfo(sections: readonly RuleSection[], id: string, src: SourceRef): MapInfo {
  const logic = sections.find((s) => s.name === 'logiccontrol');
  if (logic === undefined) {
    throw new Error(`ini: map ${src.file} has no [logiccontrol] section`);
  }
  const size = findProp(logic, 'mapsize')?.values;
  const width = Number.parseInt(size?.[0] ?? '', 10);
  const height = Number.parseInt(size?.[1] ?? '', 10);
  if (Number.isNaN(width) || Number.isNaN(height)) {
    throw new Error(`ini: map ${src.file} has no valid \`mapsize <w> <h>\``);
  }
  const guidRaw = findProp(logic, 'mapguid')?.values ?? [];
  const guid = guidRaw.map((v) => Number.parseInt(v, 10));
  if (guid.length !== 16 || guid.some((b) => Number.isNaN(b) || b < 0 || b > 255)) {
    throw new Error(`ini: map ${src.file} has no valid 16-byte \`mapguid\``);
  }

  const mapType = sections.find((s) => s.name === 'misc_maptype');
  const mapName = sections.find((s) => s.name === 'misc_mapname');
  const info: {
    id: string;
    width: number;
    height: number;
    guid: number[];
    mapType?: number;
    campaign?: { campaignId: number; missionId: number };
    nameStringId?: number;
    descriptionStringId?: number;
    source: { file: string; block: string; layer: 'base' | 'mod' };
  } = {
    id,
    width,
    height,
    guid,
    source: makeSource(src, 'logiccontrol'),
  };
  const type = mapType !== undefined ? getInt(mapType, 'maptype') : undefined;
  if (type !== undefined) info.mapType = type;
  const campaign = mapType !== undefined ? findProp(mapType, 'mapcampaignid')?.values : undefined;
  if (campaign !== undefined) {
    const campaignId = Number.parseInt(campaign[0] ?? '', 10);
    const missionId = Number.parseInt(campaign[1] ?? '', 10);
    if (!Number.isNaN(campaignId) && !Number.isNaN(missionId)) info.campaign = { campaignId, missionId };
  }
  const nameStringId = mapName !== undefined ? getInt(mapName, 'mapnamestringid') : undefined;
  if (nameStringId !== undefined) info.nameStringId = nameStringId;
  const descriptionStringId = mapName !== undefined ? getInt(mapName, 'mapdescriptionstringid') : undefined;
  if (descriptionStringId !== undefined) info.descriptionStringId = descriptionStringId;

  return MapInfo.parse(info);
}

/** The decoded `StaticObjects` placements of one map — the on-disk `entities` layer's shape. */
export interface MapStaticObjects {
  buildings: {
    name: string;
    level: number;
    player: number;
    hx: number;
    hy: number;
    rot?: number;
    /** Authored starting stock (`addgoods` verbs following this `sethouse`): good names verbatim. */
    goods?: { name: string; count: number }[];
  }[];
  humans: {
    tribe: string;
    role: string;
    player: number;
    hx: number;
    hy: number;
    /** The human's authored produced good (`setproducedgood`): a good name verbatim. */
    producedGood?: string;
  }[];
  animals: { species: string; hx: number; hy: number }[];
}

/** The verbs that place an entity — each one ends the previous placement's block of modifiers. Includes
 *  `setvehicle`, which places a vehicle this decoder does not import yet but which still ends a block. */
const PLACEMENT_VERBS = new Set(['sethouse', 'sethuman', 'setanimal', 'setvehicle']);

/**
 * Extracts a map's `[StaticObjects]` authored placements — the pre-placed houses, humans and animals a
 * scenario starts with. Verb grammar (all coordinates half-cells, the `emla` 2W×2H lattice):
 *
 * ```
 * sethouse  <player(0-based)> "<GfxHouse EditName>" <level> <1: constant, unknown> <hx> <hy> <rot>
 * sethuman  <player(0-based)> "<tribe>" "<jobtype role>" <hx> <hy> <a> <b>
 * setanimal <class> "<species>" "<age>" <hx> <hy> <a> <b>
 * addgoods  "<goodtype name>" <count>
 * setproducedgood "<goodtype name>"
 * ```
 *
 * `addgoods` rows stock the entity placed by the immediately preceding placement verb (source basis:
 * across the whole unpacked `staticobjects.inc` corpus every `addgoods` run directly follows a
 * `sethouse` or `setvehicle` row). Runs after a captured `sethouse` land on that building's `goods`;
 * runs after any other verb (e.g. `setvehicle`, not imported yet) are dropped. The good is usually a
 * quoted name; the rare unquoted numeric variant (`addgoods 49 1000`, Walhalla) is a goodtype typeId,
 * kept verbatim as the digit string for the loader to resolve by id.
 *
 * The `sethouse` player is the first column, 0-based like `sethuman`'s (source basis: across all 13
 * entity-bearing mod maps its per-value position centroids coincide with the matching `sethuman`
 * player clusters — value sets equal on the multiplayer/special maps, a sub/superset on four
 * tutorials — while the fourth column is the constant `1` on every one of the 415 rows, so it
 * cannot be a player id; the unpacked `staticobjects.inc` corpus corroborates, including rows
 * where that column is `0`). Names are kept verbatim (the
 * version-robust join key the loader resolves against the IR by name).
 *
 * `setproducedgood` is a human's authored produced good, landing on the enclosing `sethuman` — the
 * original scopes the choice to the settler, not to its hut (its own UI names the window
 * `CSelectedSingleHumanChangeProducedGood`, in the same per-human family as ChangeJob/ChangeName).
 * Source basis: counting by verb, all 720 rows of the unpacked `staticobjects.inc` corpus sit inside a
 * `sethuman` block and none follows a `sethouse`; only `setexpierence` (7) and `attachtohouse` (23)
 * ever separate the two — so it binds to the last `sethuman`, which only a placement verb retargets.
 * The good is not only a gatherer's resource: workshop trades author their product the same way
 * (`baker` → `bread`), and one row authors two picks (last wins). The `setguide` verb is not captured
 * yet. A malformed row is skipped, not thrown — one bad line must not drop a whole map's placements.
 * Returns `undefined` when the map has no `StaticObjects` section or it places nothing.
 */
export function extractStaticObjects(sections: readonly RuleSection[]): MapStaticObjects | undefined {
  const sec = sections.find((s) => s.name === 'StaticObjects');
  if (sec === undefined) return undefined;
  const int = (v: string | undefined): number | undefined => {
    const n = Number.parseInt(v ?? '', 10);
    return Number.isNaN(n) || n < 0 ? undefined : n;
  };
  const out: MapStaticObjects = { buildings: [], humans: [], animals: [] };
  // The building the next `addgoods` run stocks — the last captured `sethouse`. Any other verb
  // (including a skipped-as-malformed `sethouse`) retargets goods away from it.
  let goodsTarget: MapStaticObjects['buildings'][number] | undefined;
  // The human the next `setproducedgood` picks for — the last captured `sethuman`. Unlike `goodsTarget`
  // it survives the uncaptured in-block modifiers, so only a placement verb (including a
  // skipped-as-malformed `sethuman`) retargets it.
  let producedGoodTarget: MapStaticObjects['humans'][number] | undefined;
  for (const p of sec.props) {
    if (p.key !== 'addgoods') goodsTarget = undefined;
    if (PLACEMENT_VERBS.has(p.key)) producedGoodTarget = undefined;
    if (p.key === 'setproducedgood') {
      const [name] = p.values;
      if (producedGoodTarget !== undefined && name !== undefined) producedGoodTarget.producedGood = name;
    } else if (p.key === 'addgoods') {
      const [name, countRaw] = p.values;
      const count = int(countRaw);
      if (goodsTarget === undefined || name === undefined || count === undefined || count === 0) continue;
      goodsTarget.goods ??= [];
      goodsTarget.goods.push({ name, count });
    } else if (p.key === 'sethouse') {
      const [playerRaw, name, levelRaw, , hxRaw, hyRaw, rotRaw] = p.values;
      const level = int(levelRaw);
      const player = int(playerRaw);
      const hx = int(hxRaw);
      const hy = int(hyRaw);
      const rot = int(rotRaw);
      if (
        name === undefined ||
        level === undefined ||
        player === undefined ||
        hx === undefined ||
        hy === undefined
      )
        continue;
      const building = { name, level, player, hx, hy, ...(rot !== undefined ? { rot } : {}) };
      out.buildings.push(building);
      goodsTarget = building;
    } else if (p.key === 'sethuman') {
      const [playerRaw, tribe, role, hxRaw, hyRaw] = p.values;
      const player = int(playerRaw);
      const hx = int(hxRaw);
      const hy = int(hyRaw);
      if (
        tribe === undefined ||
        role === undefined ||
        player === undefined ||
        hx === undefined ||
        hy === undefined
      )
        continue;
      const human = { tribe, role, player, hx, hy };
      out.humans.push(human);
      producedGoodTarget = human;
    } else if (p.key === 'setanimal') {
      const [, species, , hxRaw, hyRaw] = p.values;
      const hx = int(hxRaw);
      const hy = int(hyRaw);
      if (species === undefined || hx === undefined || hy === undefined) continue;
      out.animals.push({ species, hx, hy });
    }
  }
  if (out.buildings.length + out.humans.length + out.animals.length === 0) return undefined;
  return out;
}
