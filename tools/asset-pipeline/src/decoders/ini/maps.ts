/**
 * Map metadata and decoded static-object placements from a map `.cif`.
 */
import { MapInfo } from '@open-northland/data';
import type { RuleSection } from './grammar.js';
import { makeSource, type SourceRef } from './ir-fields.js';
import { findProp, getInt } from './props.js';

/**
 * Reduces one decoded `map.cif`'s logic header into a validated {@link MapInfo}: the `logiccontrol`
 * section's `mapsize <w> <h>` and `mapguid <16 bytes>`, plus the optional `misc_maptype`/`misc_mapname`
 * scalars. `id` comes from the caller (the map folder name) because the header carries no
 * human-readable map id.
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

/** The decoded `StaticObjects` placements of one map - the on-disk `entities` layer's shape. */
export interface MapStaticObjects {
  buildings: {
    name: string;
    level: number;
    player: number;
    hx: number;
    hy: number;
    rot?: number;
    /** Authored starting stock from the `addgoods` verbs following this `sethouse`, names verbatim. */
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

/** The verbs that place an entity, each ending the previous placement's block of modifiers. `setvehicle`
 *  is here because it ends a block even though this decoder does not import vehicles. */
const PLACEMENT_VERBS = new Set(['sethouse', 'sethuman', 'setanimal', 'setvehicle']);

/**
 * Extracts a map's `[StaticObjects]` authored placements. Verb grammar, with every coordinate a
 * half-cell on the `emla` 2W x 2H lattice:
 *
 * ```
 * sethouse  <player(0-based)> "<GfxHouse EditName>" <level> <1: constant, unknown> <hx> <hy> <rot>
 * sethuman  <player(0-based)> "<tribe>" "<jobtype role>" <hx> <hy> <a> <b>
 * setanimal <class> "<species>" "<age>" <hx> <hy> <a> <b>
 * addgoods  "<goodtype name>" <count>
 * setproducedgood "<goodtype name>"
 * ```
 *
 * `addgoods` stocks the entity placed by the immediately preceding placement verb, so a run after an
 * unimported `setvehicle` is dropped. Its good is usually a quoted name; the rare unquoted numeric
 * variant (`addgoods 49 1000`) is a goodtype typeId kept verbatim as its digit string.
 *
 * `setproducedgood` belongs to the enclosing `sethuman`: the original scopes that pick to the settler
 * rather than its hut, and its own UI names the window `CSelectedSingleHumanChangeProducedGood`. It is
 * not only a gatherer's resource, since workshop trades author their product the same way
 * (`baker` -> `bread`). Names stay verbatim, the join key the loader resolves against the IR.
 * The `setguide` verb is not captured.
 */
export function extractStaticObjects(sections: readonly RuleSection[]): MapStaticObjects | undefined {
  const sec = sections.find((s) => s.name === 'StaticObjects');
  if (sec === undefined) return undefined;
  const int = (v: string | undefined): number | undefined => {
    const n = Number.parseInt(v ?? '', 10);
    return Number.isNaN(n) || n < 0 ? undefined : n;
  };
  const out: MapStaticObjects = { buildings: [], humans: [], animals: [] };
  // The building the next `addgoods` run stocks: the last captured `sethouse`, which any other line
  // retargets away from.
  let goodsTarget: MapStaticObjects['buildings'][number] | undefined;
  // The human the next `setproducedgood` picks for: the last captured `sethuman`. It survives the
  // uncaptured in-block modifiers, so only a placement verb retargets it.
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
