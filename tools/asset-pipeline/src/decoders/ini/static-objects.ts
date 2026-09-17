import type { RuleSection } from './grammar.js';

/** The decoded `StaticObjects` placements of one map - the on-disk `entities` layer's shape. */
export interface MapStaticObjects {
  buildings: {
    name: string;
    level: number;
    player: number;
    hx: number;
    hy: number;
    /** The mission object id `[MissionData]` addresses this placement by. */
    missionId?: number;
    /** Authored starting stock from the `addgoods` verbs following this `sethouse`, names verbatim. */
    goods?: { name: string; count: number }[];
  }[];
  humans: {
    tribe: string;
    role: string;
    player: number;
    hx: number;
    hy: number;
    missionId?: number;
    /** The 32-bit behaviour mask the `*BehaviourFlag` results share. */
    behaviourFlags?: number;
    /** The human's authored produced good (`setproducedgood`): a good name verbatim. */
    producedGood?: string;
    /** The buildings this human is authored into (`attachtohouse`), in source order. */
    attach?: { hx: number; hy: number; slot: number }[];
    /** The vehicle this human crews (`attachtovehicle`), by its `setvehicle` half-cell; `inside` once a
     *  `moveintovehicle` boards him. */
    boardVehicleAt?: { hx: number; hy: number; inside: boolean };
  }[];
  animals: {
    species: string;
    player: number;
    hx: number;
    hy: number;
    missionId?: number;
    behaviour?: number;
  }[];
  vehicles: {
    tribe: string;
    type: string;
    player: number;
    hx: number;
    hy: number;
    missionId?: number;
    goods?: { name: string; count: number }[];
  }[];
  guides: { player: number; hx: number; hy: number }[];
}

/** The verbs that place an entity, each ending the previous placement's block of modifiers. */
const PLACEMENT_VERBS = new Set(['sethouse', 'sethuman', 'setanimal', 'setvehicle', 'setguide']);

/** What the id and behaviour columns hold when they carry nothing: the corpus writes them as 0. */
const EMPTY_COLUMN = 0;

/**
 * Extracts a map's `[StaticObjects]` authored placements. Verb grammar, with every coordinate a
 * half-cell on the `emla` 2W x 2H lattice:
 *
 * ```
 * sethouse   <player(0-based)> "<GfxHouse EditName>" <level> <1: constant, unknown> <hx> <hy> <missionId>
 * sethuman   <player(0-based)> "<tribe>" "<jobtype role>" <hx> <hy> <missionId> <behaviourFlags>
 * setanimal  <player(20: wild)> "<tribe: the species>" "<animal type>" <hx> <hy> <missionId> <behaviour>
 * setvehicle <player(0-based)> "<tribe>" "<vehicletype>" <hx> <hy> <missionId> [<0: never read>]
 * setguide   <player(0-based)> <hx> <hy>
 * addgoods   "<goodtype name>" <count>
 * setproducedgood "<goodtype name>"
 * attachtohouse <hx> <hy> <slot>
 * attachtovehicle <hx> <hy>
 * moveintovehicle
 * ```
 *
 * `addgoods` stocks the entity placed by the immediately preceding `sethouse` or `setvehicle`. Its
 * good is usually a quoted name; the rare unquoted numeric variant (`addgoods 49 1000`) is a goodtype
 * typeId kept verbatim as its digit string.
 *
 * `setproducedgood` belongs to the enclosing `sethuman`: the original scopes that pick to the settler
 * rather than its hut, and its own UI offers the change on the selected settler. It is
 * not only a gatherer's resource, since workshop trades author their product the same way
 * (`baker` -> `bread`). Names stay verbatim, the join key the loader resolves against the IR.
 *
 * `attachtohouse` scopes to its enclosing `sethuman` the same way, and repeats: a human may name both a
 * home and a workplace. Its coordinates are the target `sethouse`'s own anchor half-cell, never an
 * interior one.
 *
 * `attachtovehicle` names the `setvehicle` half-cell the enclosing `sethuman` crews, and a later
 * `moveintovehicle` in the same block boards him; one without an attach has no vehicle and is dropped.
 * Fifteen corpus `setvehicle` rows carry an eighth `0` column the original never reads.
 */
export function extractStaticObjects(sections: readonly RuleSection[]): MapStaticObjects | undefined {
  const sec = sections.find((s) => s.name === 'StaticObjects');
  if (sec === undefined) return undefined;
  const int = (v: string | undefined): number | undefined => {
    const n = Number.parseInt(v ?? '', 10);
    return Number.isNaN(n) || n < 0 ? undefined : n;
  };
  const optionalColumn = (v: string | undefined): number | undefined => {
    const n = int(v);
    return n === EMPTY_COLUMN ? undefined : n;
  };
  const out: MapStaticObjects = { buildings: [], humans: [], animals: [], vehicles: [], guides: [] };
  // The entity the next `addgoods` run stocks: the last captured `sethouse` or `setvehicle`, which any
  // other line retargets away from.
  let goodsTarget: MapStaticObjects['buildings'][number] | MapStaticObjects['vehicles'][number] | undefined;
  // The human the next in-block modifier applies to: the last captured `sethuman`. It survives the
  // uncaptured in-block modifiers, so only a placement verb retargets it.
  let humanTarget: MapStaticObjects['humans'][number] | undefined;
  for (const p of sec.props) {
    if (p.key !== 'addgoods') goodsTarget = undefined;
    if (PLACEMENT_VERBS.has(p.key)) humanTarget = undefined;
    if (p.key === 'setproducedgood') {
      const [name] = p.values;
      if (humanTarget !== undefined && name !== undefined) humanTarget.producedGood = name;
    } else if (p.key === 'attachtohouse') {
      const [hxRaw, hyRaw, slotRaw] = p.values;
      const hx = int(hxRaw);
      const hy = int(hyRaw);
      const slot = int(slotRaw);
      if (humanTarget === undefined || hx === undefined || hy === undefined || slot === undefined) continue;
      humanTarget.attach ??= [];
      humanTarget.attach.push({ hx, hy, slot });
    } else if (p.key === 'attachtovehicle') {
      const [hxRaw, hyRaw] = p.values;
      const hx = int(hxRaw);
      const hy = int(hyRaw);
      if (humanTarget === undefined || hx === undefined || hy === undefined) continue;
      humanTarget.boardVehicleAt = { hx, hy, inside: false };
    } else if (p.key === 'moveintovehicle') {
      if (humanTarget?.boardVehicleAt !== undefined) humanTarget.boardVehicleAt.inside = true;
    } else if (p.key === 'addgoods') {
      const [name, countRaw] = p.values;
      const count = int(countRaw);
      if (goodsTarget === undefined || name === undefined || count === undefined || count === 0) continue;
      goodsTarget.goods ??= [];
      goodsTarget.goods.push({ name, count });
    } else if (p.key === 'sethouse') {
      const [playerRaw, name, levelRaw, , hxRaw, hyRaw, missionIdRaw] = p.values;
      const level = int(levelRaw);
      const player = int(playerRaw);
      const hx = int(hxRaw);
      const hy = int(hyRaw);
      const missionId = optionalColumn(missionIdRaw);
      if (
        name === undefined ||
        level === undefined ||
        player === undefined ||
        hx === undefined ||
        hy === undefined
      )
        continue;
      const building = { name, level, player, hx, hy, ...(missionId !== undefined ? { missionId } : {}) };
      out.buildings.push(building);
      goodsTarget = building;
    } else if (p.key === 'sethuman') {
      const [playerRaw, tribe, role, hxRaw, hyRaw, missionIdRaw, behaviourRaw] = p.values;
      const player = int(playerRaw);
      const hx = int(hxRaw);
      const hy = int(hyRaw);
      const missionId = optionalColumn(missionIdRaw);
      const behaviourFlags = optionalColumn(behaviourRaw);
      if (
        tribe === undefined ||
        role === undefined ||
        player === undefined ||
        hx === undefined ||
        hy === undefined
      )
        continue;
      const human = {
        tribe,
        role,
        player,
        hx,
        hy,
        ...(missionId !== undefined ? { missionId } : {}),
        ...(behaviourFlags !== undefined ? { behaviourFlags } : {}),
      };
      out.humans.push(human);
      humanTarget = human;
    } else if (p.key === 'setanimal') {
      const [playerRaw, species, , hxRaw, hyRaw, missionIdRaw, behaviourRaw] = p.values;
      const player = int(playerRaw);
      const hx = int(hxRaw);
      const hy = int(hyRaw);
      const missionId = optionalColumn(missionIdRaw);
      const behaviour = optionalColumn(behaviourRaw);
      if (species === undefined || player === undefined || hx === undefined || hy === undefined) continue;
      out.animals.push({
        species,
        player,
        hx,
        hy,
        ...(missionId !== undefined ? { missionId } : {}),
        ...(behaviour !== undefined ? { behaviour } : {}),
      });
    } else if (p.key === 'setvehicle') {
      const [playerRaw, tribe, type, hxRaw, hyRaw, missionIdRaw] = p.values;
      const player = int(playerRaw);
      const hx = int(hxRaw);
      const hy = int(hyRaw);
      const missionId = optionalColumn(missionIdRaw);
      if (
        tribe === undefined ||
        type === undefined ||
        player === undefined ||
        hx === undefined ||
        hy === undefined
      )
        continue;
      const vehicle = { tribe, type, player, hx, hy, ...(missionId !== undefined ? { missionId } : {}) };
      out.vehicles.push(vehicle);
      goodsTarget = vehicle;
    } else if (p.key === 'setguide') {
      const [playerRaw, hxRaw, hyRaw] = p.values;
      const player = int(playerRaw);
      const hx = int(hxRaw);
      const hy = int(hyRaw);
      if (player === undefined || hx === undefined || hy === undefined) continue;
      out.guides.push({ player, hx, hy });
    }
  }
  const placed =
    out.buildings.length + out.humans.length + out.animals.length + out.vehicles.length + out.guides.length;
  return placed === 0 ? undefined : out;
}
