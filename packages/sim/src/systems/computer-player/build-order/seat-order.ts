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
import { type GamePhase, gamePhase } from '../game-phase.js';
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
  type SitePace,
  sitePace,
} from './entries.js';

/** What an economic archetype changes about the build order and its placements (authored). */
export interface ArchetypeTuning {
  /** The line priority the seat starts from, first id first, before its sides, phase and posture move
   *  lines up. */
  readonly priority: readonly BuildLineId[];
  /** A placement asking for more than one copy asks for this percent of them, rounded down, at least one. */
  readonly copiesPct: number;
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
  readonly leadOnlyWhen: 'rivalOverSea' | null;
  /** Whether every placement stays on the base's own land component, not only the overflow search. */
  readonly homeLandOnly: boolean;
}

/** The default order's priority (`./entries.ts`), which a standard seat plays. */
const STANDARD_PRIORITY = DEFAULT_BUILD_ORDER.priority;

/** Owner ruling: a cramped seat (mroczny_las) has little room and digs the forest out. Authored figures:
 *  three quarters of the standard reach, twice the pull toward the base, clearing from two thirds of the
 *  standard spread, one lower-tier bakery (owner ruling: two only where there is room), the late copies of
 *  the bigger workshops and homes capped about as the medium seat's, and the economy lines in the standard
 *  order but the tile and marble upgrades and the homes' lanes ahead of the army, mint and druid lines,
 *  which add the most buildings. */
const CRAMPED: ArchetypeTuning = {
  priority: [
    'opening',
    'bread',
    'brewery',
    'clothing',
    'tools',
    'weapons',
    'materials',
    'homes',
    'military',
    'coins',
    'healing',
  ],
  copiesPct: 100,
  copyCaps: {
    work_bakery_00: 1,
    home_level_00: 8,
    work_bakery_01: 4,
    work_smithy_01: 4,
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
};

const STANDARD: ArchetypeTuning = {
  priority: STANDARD_PRIORITY,
  copiesPct: 100,
  copyCaps: {},
  extraSites: 0,
  reachNodes: BUILD_SEARCH_MAX_RADIUS_NODES,
  hqPullDivisorNodes: HQ_PULL_DIVISOR_NODES,
  clearGroundPct: 100,
  leadOnlyWhen: null,
  homeLandOnly: false,
};

/** The tuning per archetype. A rich seat (room and building deposits to spare) opens one site more and a
 *  quarter more copies; an island seat raises its ship joinery first and its army line right after the
 *  opening, and builds on its own land only. Authored. */
export const ARCHETYPE_TUNING: Readonly<Record<EconomicArchetype, ArchetypeTuning>> = {
  standard: STANDARD,
  cramped: CRAMPED,
  rich: { ...STANDARD, copiesPct: 125, extraSites: 1 },
  islands: {
    ...STANDARD,
    priority: [
      'opening',
      'military',
      ...STANDARD_PRIORITY.filter((l) => l !== 'opening' && l !== 'military'),
    ],
    leadOnlyWhen: 'rivalOverSea',
    homeLandOnly: true,
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
 *  armory's wood and the sewery's tunics. */
const IRON_ARMS: StepMatch = { buildings: ['work_smithy_00', 'work_smithy_01'], collectors: ['iron'] };

/** The herb, druid, mint and temple steps and the mushroom and gold gatherers feeding them, raised only
 *  where gold and mushrooms lie on the seat's land. */
const GOLD_LINE: StepMatch = {
  buildings: ['work_herb_hut', 'work_druid_00', 'work_druid_01', 'work_coin_mint', 'work_temple'],
  collectors: ['mushroom', 'gold'],
};

/** What each side changes (authored): the steps it drops and the steps only it keeps. `fishing` changes the workforce (`workforce/fisher.ts`); `herbs` keeps the
 *  grass reserve rules as they are (`./grass-reserve.ts`). The clothing line already runs ahead of the
 *  weapons, so a seat arming from tunics only adds its early second tailor. */
interface SideRule {
  readonly drops?: StepMatch;
  readonly keeps?: StepMatch;
}

const SIDE_RULES: Readonly<Record<EconomicSide, SideRule>> = {
  ironArms: {},
  naturalArms: { drops: IRON_ARMS, keeps: { buildings: [], collectors: [], steps: [EARLY_SECOND_TAILOR] } },
  goldLine: { keeps: GOLD_LINE },
  fishing: {},
  herbs: {},
};

/** The lines a phase moves up right behind the opening (authored): from the mid game the army line, from
 *  the late game also the homes line with its warehouse lane. */
const PHASE_RAISES: Readonly<Record<GamePhase, readonly BuildLineId[]>> = {
  opening: [],
  mid: ['military'],
  late: ['military', 'homes'],
};

/** The army, tower and weapon lines a seat raises right behind the opening while its defence comes first. */
const DEFENCE_LINES: readonly BuildLineId[] = ['military', 'weapons'];

/** Whether the seat's defence lines go ahead of its economy's later steps and its military steps stop
 *  waiting on the deadline: while it defends, prepares against a forecast attack, or knows one within the
 *  barracks' lead ({@link BARRACKS_LEAD_TICKS}), the one clock its military buildings keep. A seat that
 *  prepares only because it is still building up keeps its economy first. */
export function defenceFirst(military: DeepReadonly<MilitaryStrategyState>): boolean {
  if (military.posture === 'defend') return true;
  if (military.posture === 'prepare' && military.evidence.includes('forecastThreat')) return true;
  return military.threatInTicks !== null && military.threatInTicks <= BARRACKS_LEAD_TICKS;
}

/** Whether `player`'s seat still waits on what it needs ready `leadTicks` before its military deadline
 *  (`../military/deadline.ts`): the clock has not reached the lead and its defence does not come first. */
export function militaryWaits(world: World, ctx: SystemContext, player: number, leadTicks: number): boolean {
  return !seatDefenceFirst(world, player) && beforeDeadlineLead(world, ctx, player, leadTicks);
}

/** How dense the tower ring stands while the seat's defence comes first, in percent of its plan's radius
 *  (authored): on mroczny_las a cramped seat's whole settlement sits inside its base's own circle, so at
 *  the plan's radius it raised no tower before the first scripted wave. */
export const DEFENCE_TOWER_RADIUS_PCT = 60;

/** {@link defenceFirst} for `player`'s seat; false before its strategy is decided. */
export function seatDefenceFirst(world: World, player: number): boolean {
  const carrier = aiControlEntity(world, player);
  const strategy = carrier === null ? undefined : world.tryGet(carrier, ComputerStrategy);
  return strategy !== undefined && defenceFirst(strategy.military);
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
 * kept steps, then the phase's and the defence's raised lines. Memoized per order and
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
  const rules = sideRules(shape.sides);
  const lines = order.lines.map((line) => shapeLine(line, tuning, rules));
  let priority = tuning === STANDARD ? order.priority : tuning.priority;
  priority = raised(priority, PHASE_RAISES[shape.phase], 'opening');
  if (shape.defenceFirst) priority = raised(priority, DEFENCE_LINES, 'opening');
  const shaped: BuildOrder =
    lines.every((line, i) => line === order.lines[i]) && priority === order.priority
      ? order
      : { lines, priority };
  byShape.set(key, shaped);
  return shaped;
}

/** The rules of the sides held and, for each side lacking, the steps only it keeps, as a drop. */
function sideRules(sides: readonly EconomicSide[]): SideRule[] {
  const rules: SideRule[] = [];
  for (const side of Object.keys(SIDE_RULES) as EconomicSide[]) {
    const rule = SIDE_RULES[side];
    if (sides.includes(side)) rules.push(rule);
    else if (rule.keeps !== undefined) rules.push({ drops: rule.keeps });
  }
  return rules;
}

function shapeLine(line: BuildLine, tuning: ArchetypeTuning, rules: readonly SideRule[]): BuildLine {
  let steps = line.steps.filter(
    (entry) => !rules.some((rule) => rule.drops !== undefined && matches(rule.drops, entry)),
  );
  if (tuning !== STANDARD) steps = steps.map((entry) => copiesOf(entry, tuning));
  if (tuning.leadOnlyWhen !== null) {
    const lead = tuning.leadOnlyWhen;
    const leading = (entry: BuildOrderEntry) => entry.kind === 'place' && entry.onlyWhen === lead;
    steps = [...steps.filter(leading), ...steps.filter((entry) => !leading(entry))];
  }
  return steps.length === line.steps.length && steps.every((entry, i) => entry === line.steps[i])
    ? line
    : { id: line.id, steps };
}

/** A placement asking for more than one copy, its count scaled by the tuning's percent, then cut to its
 *  cap. A cap never drops the step: a count already under it stands met the sooner. */
function copiesOf(entry: BuildOrderEntry, tuning: ArchetypeTuning): BuildOrderEntry {
  if ((entry.kind !== 'place' && entry.kind !== 'housing') || entry.count <= 1) return entry;
  const scaled = Math.max(1, Math.floor((entry.count * tuning.copiesPct) / 100));
  const count = Math.min(scaled, tuning.copyCaps[entry.building] ?? scaled);
  return count === entry.count ? entry : { ...entry, count };
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

/** The seat's archetype tuning; a seat with no strategy decided yet plays the standard one. */
export function seatTuning(world: World, player: number): ArchetypeTuning {
  const carrier = aiControlEntity(world, player);
  const strategy = carrier === null ? undefined : world.tryGet(carrier, ComputerStrategy);
  return ARCHETYPE_TUNING[strategy?.economy.archetype ?? 'standard'];
}

/** Whether the seat's economy leans on `side`; false before its strategy is decided. */
export function seatHasSide(world: World, player: number, side: EconomicSide): boolean {
  const carrier = aiControlEntity(world, player);
  const strategy = carrier === null ? undefined : world.tryGet(carrier, ComputerStrategy);
  return strategy?.economy.sides.includes(side) ?? false;
}

/** The build order `player`'s seat plays at `tick`: `order` shaped by its strategy, then trimmed by its
 *  difficulty `profile`. A seat with no strategy decided yet plays the order with every side's steps. */
export function seatBuildOrder(
  world: World,
  player: number,
  tick: number,
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
          phase: gamePhase(tick),
          defenceFirst: defenceFirst(strategy.military),
        });
  return profileBuildOrder(shaped, profile);
}

/** The step of the seat's pace at `tick`: its difficulty's, plus its archetype's extra sites. */
export function seatSitePace(world: World, player: number, profile: ComputerProfile, tick: number): SitePace {
  const pace = sitePace(profile, tick);
  const extra = seatTuning(world, player).extraSites;
  return extra === 0 ? pace : { ...pace, sites: pace.sites + extra };
}
