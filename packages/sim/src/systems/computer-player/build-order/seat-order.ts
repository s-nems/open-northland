import {
  aiControlEntity,
  ComputerStrategy,
  type EconomicArchetype,
  type EconomicSide,
  type MilitaryStrategyState,
} from '../../../components/index.js';
import type { DeepReadonly, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { type ComputerProfile, profileBuildOrder } from '../difficulty.js';
import { type GamePhase, gamePhase, minutesToTicks } from '../game-phase.js';
import { BARRACKS_LEAD_TICKS, beforeDeadlineLead } from '../military/deadline.js';
import {
  BUILD_SEARCH_MAX_RADIUS_NODES,
  type BuildLine,
  type BuildLineId,
  type BuildOrder,
  type BuildOrderEntry,
  DEFAULT_BUILD_ORDER,
  EARLY_SECOND_TAILOR,
  HQ_PULL_DIVISOR_NODES,
  LATE_SMITHIES,
  LATER_MINTS,
  RICH_STEPS,
  ROOMY_OPENING_HOMES,
  SECOND_ANIMAL_FARM,
  SECOND_ANIMAL_FARM_WELL,
  SECOND_UPPER_TAILOR,
  type SitePace,
  type StepHold,
  sitePace,
} from './entries.js';
import { CATAPULT_JOINERY } from './military-line.js';

/** What an economic archetype changes about the build order and its placements (authored). */
export interface ArchetypeTuning {
  /** The line priority the seat starts from, first id first, before its sides, phase and posture move
   *  lines up. */
  readonly priority: readonly BuildLineId[];
  /** The most copies of a building, by stable content id, a placement asks for. */
  readonly copyCaps: Readonly<Record<string, number>>;
  /** Construction sites over the difficulty's pace, in every phase. */
  readonly extraSites: number;
  /** How far from the nearest of the seat's buildings a placement may land, in half-cell Manhattan nodes. */
  readonly reachNodes: number;
  /** Manhattan nodes from the base that cost a spot one ring from its search centre: lower packs tighter. */
  readonly hqPullDivisorNodes: number;
  /** How far the farthest home stands before collect-anything gatherers clear room, in percent of the
   *  standard spread (`workforce/collectors/wanted-goods.ts`). */
  readonly clearGroundPct: number;
  /** Whether a step whose `onlyWhen` names this leads its line, ahead of the steps declared before it. */
  readonly leadOnlyWhen: 'needsShips' | null;
  /** Whether every placement stays on the base's own land component, not only the overflow search. */
  readonly homeLandOnly: boolean;
  /** Steps of the order the archetype leaves out. */
  readonly drops: readonly BuildOrderEntry[];
  /** The buildings whose placements wait on {@link SHIP_JOINERY_FIRST}. */
  readonly afterShipJoinery?: readonly string[];
}

/** The default order's priority (`./entries.ts`), which a standard seat plays. */
const STANDARD_PRIORITY = DEFAULT_BUILD_ORDER.priority;

const SHIP_JOINERY_FIRST_MINUTES = 50;

/** Owner ruling: a cramped seat (mroczny_las) has little room and digs the forest out. Authored figures:
 *  three quarters of the standard reach, twice the pull toward the base, clearing from two thirds of the
 *  standard spread, one bakery and the three first homes (owner ruling: two bakeries and more homes only
 *  where there is room), the late copies of the bigger workshops capped about as the medium seat's and
 *  eight homes, and the economy lines in the standard order but the tile and marble upgrades and the homes'
 *  lanes ahead of the army, mint and druid lines, which add the most buildings. */
const CRAMPED: ArchetypeTuning = {
  priority: [
    'opening',
    'bread',
    'brewery',
    'tools',
    'clothing',
    'weapons',
    'armory',
    'materials',
    'homes',
    'military',
    'coins',
    'healing',
  ],
  copyCaps: {
    work_bakery_00: 1,
    home_level_00: 8,
    work_bakery_01: 1,
    work_brewery: 2,
    work_hive_00: 2,
    work_druid_01: 4,
    work_coin_mint: 2,
  },
  extraSites: 0,
  reachNodes: (3 * BUILD_SEARCH_MAX_RADIUS_NODES) / 4,
  hqPullDivisorNodes: HQ_PULL_DIVISOR_NODES / 2,
  clearGroundPct: 67,
  leadOnlyWhen: null,
  homeLandOnly: false,
  drops: [ROOMY_OPENING_HOMES, ...RICH_STEPS],
};

/** Owner ruling: a seat with medium room (krwawa_rzeka) keeps to ten homes. */
const STANDARD_HOMES = 10;

const STANDARD: ArchetypeTuning = {
  priority: STANDARD_PRIORITY,
  copyCaps: { home_level_00: STANDARD_HOMES },
  extraSites: 0,
  reachNodes: BUILD_SEARCH_MAX_RADIUS_NODES,
  hqPullDivisorNodes: HQ_PULL_DIVISOR_NODES,
  clearGroundPct: 100,
  leadOnlyWhen: null,
  homeLandOnly: false,
  drops: RICH_STEPS,
};

/** Authored from the owner's ruling that the island plan's carpenter reaches ships sooner: the ship joinery
 *  goes ahead of the upper workshops, which otherwise spread the few builders of its opening over many sites
 *  at once (observed on arabskie_wyspy_wolna_gra_mieszana). The wait ends with the top tier or at game minute
 *  50, so a seat stuck on it still arms, and at once for a seat whose defence comes first or that has no ship
 *  to build. */
const SHIP_JOINERY_FIRST: StepHold = {
  kind: 'any',
  holds: [
    { kind: 'shipPath' },
    { kind: 'built', building: 'work_joinery_03' },
    { kind: 'tick', tick: minutesToTicks(SHIP_JOINERY_FIRST_MINUTES) },
  ],
};

/** The tuning per archetype. A rich seat (room, iron and gold to spare) opens one site more and plays the
 *  rich steps (`./entries.ts`) with every home of the housing lane; an island seat raises its ship joinery
 *  first and its army line right after the opening, and builds on its own land only. Authored. */
export const ARCHETYPE_TUNING: Readonly<Record<EconomicArchetype, ArchetypeTuning>> = {
  standard: STANDARD,
  cramped: CRAMPED,
  rich: { ...STANDARD, copyCaps: {}, extraSites: 1, drops: [] },
  islands: {
    ...STANDARD,
    // Owner ruling: on the island plan the carpenter gets much higher priority, to reach ships sooner. He
    // opens the whole sea path, so his line runs right behind the ship joinery's.
    priority: [
      'opening',
      'military',
      'tools',
      ...STANDARD_PRIORITY.filter((l) => l !== 'opening' && l !== 'military' && l !== 'tools'),
    ],
    leadOnlyWhen: 'needsShips',
    homeLandOnly: true,
    afterShipJoinery: ['work_smithy_00', 'work_armory_00', 'work_sewery_00'],
  },
};

/** The steps a side rule names: placements and upgrades of these buildings, or of a building serving one
 *  of them (a well's `unlessWithin`), collectors of these goods, and the named steps themselves. */
interface StepMatch {
  readonly buildings: readonly string[];
  readonly collectors: readonly string[];
  readonly steps?: readonly BuildOrderEntry[];
}

function matches(match: StepMatch, entry: BuildOrderEntry): boolean {
  if (match.steps?.includes(entry) === true) return true;
  switch (entry.kind) {
    case 'collector':
      return match.collectors.includes(entry.good);
    case 'place':
      return (
        match.buildings.includes(entry.building) ||
        (entry.unlessWithin !== undefined && match.buildings.includes(entry.unlessWithin.building))
      );
    case 'upgrade':
      return match.buildings.includes(entry.building);
    case 'towerCoverage':
    case 'storeCoverage':
    case 'housing':
      return false;
  }
}

/** Owner ruling: a seat arming without iron drops the iron gatherer and the smithies, and arms from the
 *  armory's wood and the tailors' tunics. */
const IRON_ARMS: StepMatch = { buildings: ['work_smithy_00', 'work_smithy_01'], collectors: ['iron'] };

/** The herb, druid, mint and temple steps and the mushroom and gold gatherers feeding them, raised only
 *  where gold and mushrooms lie on the seat's land. */
const GOLD_LINE: StepMatch = {
  buildings: ['work_herb_hut', 'work_druid_00', 'work_druid_01', 'work_coin_mint', 'work_temple'],
  collectors: ['mushroom', 'gold'],
};

/** Owner ruling: a seat dressing its army in tunics raises its second animal farm right after the first
 *  and both tailors at once, then upgrades both, its clothing line ahead of the tools
 *  ({@link TUNIC_SIDES}). The clothing line already runs ahead of the weapons. */
const TUNIC_ARMS: StepMatch = {
  buildings: [],
  collectors: [],
  steps: [EARLY_SECOND_TAILOR, SECOND_UPPER_TAILOR, SECOND_ANIMAL_FARM, SECOND_ANIMAL_FARM_WELL],
};

/** The most homes of a seat with no room (authored): a cramped seat fits eight homes on 3.3-3.5k free
 *  nodes of home band, about 420 nodes a home, and the islands' home bands hold 1.5-3.2k, 2.6k on average.
 *  What the seat's own ground holds may cut it further (`./ground-plan.ts`). */
export const NO_ROOM_HOMES = 6;

/** Owner ruling: a seat with almost no room to grow (arabskie_wyspy_wolna_gra_mieszana's islands) limits
 *  its expansion hard: one smithy, bakery, animal farm, tailor, brewery and armory, fewer homes, no
 *  catapults. Its gold line already goes where no gold lies on its land. */
const NO_ROOM_COPY_CAPS: Readonly<Record<string, number>> = {
  work_smithy_00: 1,
  work_smithy_01: 1,
  work_bakery_00: 1,
  work_bakery_01: 1,
  work_animal_farm: 1,
  work_sewery_00: 1,
  work_sewery_01: 1,
  work_brewery: 1,
  work_hive_00: 1,
  work_armory_00: 1,
  work_armory_01: 1,
  home_level_00: NO_ROOM_HOMES,
};

/** What each side changes (authored): the steps it drops, the steps only the sides keeping them play, and
 *  copy caps under the archetype's. `fishing` changes the workforce (`workforce/fisher.ts`); `herbs` keeps
 *  the grass reserve rules as they are (`./grass-reserve.ts`). Owner ruling: a seat with little iron forges
 *  weapons in two upper smithies and a seat with little gold strikes coins in one mint. `tightGround` lifts
 *  every step's `belowTier`, so a top-tier joinery meets the tools line, and lets a copy with no room
 *  pass ({@link BuildOrderEntry} `yieldsRoom`). */
interface SideRule {
  readonly drops?: StepMatch;
  readonly keeps?: StepMatch;
  readonly copyCaps?: Readonly<Record<string, number>>;
  readonly tightGround?: true;
}

const SIDE_RULES: Readonly<Record<EconomicSide, SideRule>> = {
  ironArms: {},
  ironWeapons: { drops: { buildings: [], collectors: [], steps: LATE_SMITHIES }, keeps: TUNIC_ARMS },
  naturalArms: { drops: IRON_ARMS, keeps: TUNIC_ARMS },
  goldLine: { keeps: GOLD_LINE },
  oneMint: { drops: { buildings: [], collectors: [], steps: LATER_MINTS } },
  fishing: {},
  herbs: {},
  noRoom: {
    drops: { buildings: [], collectors: [], steps: [ROOMY_OPENING_HOMES, CATAPULT_JOINERY] },
    copyCaps: NO_ROOM_COPY_CAPS,
    // Owner ruling: no second carpenter beside the one the seat has. Without catapults every top-tier
    // joinery of this side works tools (`workforce/craft.ts`), the ship joinery once its fleet stands.
    tightGround: true,
  },
};

/** The sides dressing the army in tunics, whose seat moves its clothing line up right behind the brewery
 *  (owner ruling: many tunics fast, the shoes along). */
export const TUNIC_SIDES: readonly EconomicSide[] = (Object.keys(SIDE_RULES) as EconomicSide[]).filter(
  (side) => SIDE_RULES[side].keeps === TUNIC_ARMS,
);

/** The lines a phase moves up right behind the opening (authored): from the mid game the army line, from
 *  the late game also the homes line with its warehouse lane. */
const PHASE_RAISES: Readonly<Record<GamePhase, readonly BuildLineId[]>> = {
  opening: [],
  mid: ['military'],
  late: ['military', 'homes'],
};

/** The army, tower and weapon lines a seat raises right behind the opening while its defence comes first. */
export const DEFENCE_LINES: readonly BuildLineId[] = ['military', 'weapons', 'armory'];

/** Whether the seat's defence lines go ahead of its economy's later steps and its military steps stop
 *  waiting on the deadline: while it fights off a raid, prepares against a forecast attack, knows one
 *  within the barracks' lead ({@link BARRACKS_LEAD_TICKS}), the one clock its military buildings keep, or
 *  defends against a stronger enemy once `deadlineNear` (the clock within that lead of its military
 *  deadline). Owner ruling, food before arms: a stronger enemy the peace still holds off leaves the economy
 *  first. A seat that prepares only because it is still building up keeps its economy first. */
export function defenceFirst(military: DeepReadonly<MilitaryStrategyState>, deadlineNear: boolean): boolean {
  if (military.posture === 'defend' && (deadlineNear || military.evidence.includes('underAttack')))
    return true;
  if (military.posture === 'prepare' && military.evidence.includes('forecastThreat')) return true;
  return military.threatInTicks !== null && military.threatInTicks <= BARRACKS_LEAD_TICKS;
}

/** Whether `player`'s seat still waits on what it needs ready `leadTicks` before its military deadline
 *  (`../military/deadline.ts`): the clock has not reached the lead and its defence does not come first. */
export function militaryWaits(world: World, ctx: SystemContext, player: number, leadTicks: number): boolean {
  return !seatDefenceFirst(world, ctx, player) && beforeDeadlineLead(world, ctx, player, leadTicks);
}

/** {@link defenceFirst} for `player`'s seat; false before its strategy is decided. */
export function seatDefenceFirst(world: World, ctx: SystemContext, player: number): boolean {
  const carrier = aiControlEntity(world, player);
  const strategy = carrier === null ? undefined : world.tryGet(carrier, ComputerStrategy);
  return strategy !== undefined && defenceFirst(strategy.military, deadlineNear(world, ctx, player));
}

/** Whether the clock stands within the barracks' lead of `player`'s military deadline. */
function deadlineNear(world: World, ctx: SystemContext, player: number): boolean {
  return !beforeDeadlineLead(world, ctx, player, BARRACKS_LEAD_TICKS);
}

/** The inputs a seat's build order is shaped by. */
interface OrderShape {
  readonly archetype: EconomicArchetype;
  readonly sides: readonly EconomicSide[];
  readonly phase: GamePhase;
  readonly defenceFirst: boolean;
}

function shapeKey(shape: OrderShape): string {
  return `${shape.archetype}|${shape.sides.join(',')}|${shape.phase}|${shape.defenceFirst}`;
}

const shapedOrders = new WeakMap<BuildOrder, Map<string, BuildOrder>>();

/**
 * `order` as `shape` plays it: the archetype's priority, copies and leading steps, each side's dropped and
 * kept steps, then the tunic sides', the phase's and the defence's raised lines. Memoized per order and
 * shape, so the caches keyed on an order stay shared; the steps depend only on the archetype and sides,
 * which a seat brief keeps steady, so a line's step keys stay put while the phase and posture move
 * priorities.
 */
export function shapeBuildOrder(order: BuildOrder, shape: OrderShape): BuildOrder {
  let byShape = shapedOrders.get(order);
  if (byShape === undefined) {
    byShape = new Map();
    shapedOrders.set(order, byShape);
  }
  const key = shapeKey(shape);
  const known = byShape.get(key);
  if (known !== undefined) return known;
  const tuning = ARCHETYPE_TUNING[shape.archetype];
  const drops = sideDrops(shape.sides);
  const caps = copyCapsOf(tuning, shape.sides);
  const tightGround = shape.sides.some((side) => SIDE_RULES[side].tightGround === true);
  const lines = order.lines.map((line) => shapeLine(line, tuning, drops, caps, tightGround));
  // An archetype on the default priority keeps the order's own; one with an authored priority plays it.
  let priority = tuning.priority === STANDARD_PRIORITY ? order.priority : tuning.priority;
  if (shape.sides.some((side) => TUNIC_SIDES.includes(side)))
    priority = raised(priority, ['clothing'], 'brewery');
  priority = raised(priority, PHASE_RAISES[shape.phase], 'opening');
  if (shape.defenceFirst) priority = raised(priority, DEFENCE_LINES, 'opening');
  const shaped: BuildOrder =
    lines.every((line, i) => line === order.lines[i]) && priority === order.priority
      ? order
      : { lines, priority };
  byShape.set(key, shaped);
  return shaped;
}

/** Whether a step goes, given the sides held: a held side drops it, or every side keeping it is lacking. */
type SideDrop = (entry: BuildOrderEntry) => boolean;

function sideDrops(sides: readonly EconomicSide[]): SideDrop {
  const held: SideRule[] = [];
  const lacking: StepMatch[] = [];
  for (const side of Object.keys(SIDE_RULES) as EconomicSide[]) {
    const rule = SIDE_RULES[side];
    if (sides.includes(side)) held.push(rule);
    else if (rule.keeps !== undefined) lacking.push(rule.keeps);
  }
  return (entry) =>
    held.some((rule) => rule.drops !== undefined && matches(rule.drops, entry)) ||
    (lacking.some((keeps) => matches(keeps, entry)) &&
      !held.some((rule) => rule.keeps !== undefined && matches(rule.keeps, entry)));
}

type CopyCaps = Readonly<Record<string, number>>;

/** The archetype's copy caps with each held side's laid over them, the lower cap winning. */
function copyCapsOf(tuning: ArchetypeTuning, sides: readonly EconomicSide[]): CopyCaps {
  let caps = tuning.copyCaps;
  for (const side of sides) {
    const sideCaps = SIDE_RULES[side].copyCaps;
    if (sideCaps === undefined) continue;
    const merged: Record<string, number> = { ...caps };
    for (const [building, cap] of Object.entries(sideCaps))
      merged[building] = Math.min(cap, merged[building] ?? cap);
    caps = merged;
  }
  return caps;
}

function shapeLine(
  line: BuildLine,
  tuning: ArchetypeTuning,
  dropped: SideDrop,
  caps: CopyCaps,
  tightGround: boolean,
): BuildLine {
  let steps = line.steps
    .filter((entry) => !tuning.drops.includes(entry) && !dropped(entry))
    .flatMap((entry) => copiesOf(entry, caps))
    .map((entry) => (tightGround ? onTightGround(entry) : entry));
  const waiting = tuning.afterShipJoinery;
  if (waiting !== undefined) steps = steps.map((entry) => afterShipJoinery(entry, waiting));
  if (tuning.leadOnlyWhen !== null) {
    const lead = tuning.leadOnlyWhen;
    const leading = (entry: BuildOrderEntry) =>
      (entry.kind === 'place' || entry.kind === 'upgrade') && entry.onlyWhen === lead;
    steps = [...steps.filter(leading), ...steps.filter((entry) => !leading(entry))];
  }
  return steps.length === line.steps.length && steps.every((entry, i) => entry === line.steps[i])
    ? line
    : { id: line.id, steps };
}

/** A placement, upgrade or housing lane asking for more than one copy, its count cut to the seat's cap.
 *  A cap never drops an upgrade or a lane: a count already under it stands met the sooner. A copy placement
 *  capped to one goes, since its line's first placement already raises that one, and while that building
 *  climbs a tier the copy would count none at its own tier and raise a second. */
function copiesOf(entry: BuildOrderEntry, caps: CopyCaps): BuildOrderEntry[] {
  if ((entry.kind !== 'place' && entry.kind !== 'upgrade' && entry.kind !== 'housing') || entry.count <= 1)
    return [entry];
  const count = Math.min(entry.count, caps[entry.building] ?? entry.count);
  if (count === entry.count) return [entry];
  return entry.kind === 'place' && count === 1 ? [] : [{ ...entry, count }];
}

/** `entry` waiting on {@link SHIP_JOINERY_FIRST} too when it places one of `buildings`. */
function afterShipJoinery(entry: BuildOrderEntry, buildings: readonly string[]): BuildOrderEntry {
  if (entry.kind !== 'place' || !buildings.includes(entry.building)) return entry;
  const held = entry.holdUntil;
  const holdUntil: StepHold =
    held === undefined ? SHIP_JOINERY_FIRST : { kind: 'all', holds: [held, SHIP_JOINERY_FIRST] };
  return { ...entry, holdUntil };
}

/** `entry` on a seat with {@link SideRule} `tightGround`, its own object when that changes nothing. */
function onTightGround(entry: BuildOrderEntry): BuildOrderEntry {
  if (entry.kind !== 'place' && entry.kind !== 'upgrade') return entry;
  const { belowTier: _cap, ...uncapped } = entry;
  if (entry.kind === 'place' && entry.count > 1) return { ...uncapped, kind: 'place', yieldsRoom: true };
  return entry.belowTier === undefined ? entry : uncapped;
}

/** `priority` with `lines` moved, in their order, right behind `behind`. */
function raised(
  priority: readonly BuildLineId[],
  lines: readonly BuildLineId[],
  behind: BuildLineId,
): readonly BuildLineId[] {
  if (lines.length === 0) return priority;
  const rest = priority.filter((id) => !lines.includes(id));
  const at = rest.indexOf(behind);
  const result = [...rest.slice(0, at + 1), ...lines, ...rest.slice(at + 1)];
  return result.every((id, i) => id === priority[i]) ? priority : result;
}

/** The seat's economic archetype; null before its strategy is decided. */
export function seatArchetype(world: World, player: number): EconomicArchetype | null {
  const carrier = aiControlEntity(world, player);
  const strategy = carrier === null ? undefined : world.tryGet(carrier, ComputerStrategy);
  return strategy?.economy.archetype ?? null;
}

/** The seat's archetype tuning; a seat with no strategy decided yet plays the standard one. */
export function seatTuning(world: World, player: number): ArchetypeTuning {
  return ARCHETYPE_TUNING[seatArchetype(world, player) ?? 'standard'];
}

/** Whether the seat's economy leans on `side`; false before its strategy is decided. */
export function seatHasSide(world: World, player: number, side: EconomicSide): boolean {
  const carrier = aiControlEntity(world, player);
  const strategy = carrier === null ? undefined : world.tryGet(carrier, ComputerStrategy);
  return strategy?.economy.sides.includes(side) ?? false;
}

/** The build order `player`'s seat plays now: `order` shaped by its strategy, then trimmed by its
 *  difficulty `profile`. A seat with no strategy decided yet plays the order with every side's steps. */
export function seatBuildOrder(
  world: World,
  ctx: SystemContext,
  player: number,
  order: BuildOrder,
  profile: ComputerProfile,
): BuildOrder {
  const carrier = aiControlEntity(world, player);
  const strategy = carrier === null ? undefined : world.tryGet(carrier, ComputerStrategy);
  const shaped =
    strategy === undefined
      ? order
      : shapeBuildOrder(order, {
          archetype: strategy.economy.archetype,
          sides: strategy.economy.sides,
          phase: gamePhase(ctx.tick),
          defenceFirst: defenceFirst(strategy.military, deadlineNear(world, ctx, player)),
        });
  return profileBuildOrder(shaped, profile);
}

/** The step of the seat's pace at `tick`: its difficulty's, plus its archetype's extra sites. */
export function seatSitePace(world: World, player: number, profile: ComputerProfile, tick: number): SitePace {
  const pace = sitePace(profile, tick);
  const extra = seatTuning(world, player).extraSites;
  return extra === 0 ? pace : { ...pace, sites: pace.sites + extra };
}
