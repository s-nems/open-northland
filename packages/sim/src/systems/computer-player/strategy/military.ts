import {
  aiControlEntity,
  ComputerStrategy,
  diplomacyStance,
  MILITARY_PLANS,
  MILITARY_RULES,
  type MilitaryChoice,
  type MilitaryPlan,
  type MilitaryPosture,
  type MilitaryRule,
  type MilitaryStrategyState,
  mapBriefOf,
  NEVER_SEEN,
} from '../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { DeepReadonly, World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { raidOnTheSettlement, seatRaiders } from '../../ai-shared/military/defence/index.js';
import { ownedBuildings } from '../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../context.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { seatBarracksOf } from '../base.js';
import { computerProfileOf, type Share } from '../difficulty.js';
import { believedEnemyBuildings } from '../knowledge/intel/index.js';
import { type SeatThreat, seatMapIntentOf, seatTerritoryOf } from '../knowledge/map-intent/index.js';
import { campaignObjective } from '../military/campaign.js';
import {
  type BelievedArmy,
  believedDefendingPoints,
  ownArmyPoints,
  strongestBelievedEnemy,
} from '../military/enemy-strength.js';
import { friendHoldsArea, holdAreaOf, postOf, stayingGuardians } from '../military/operations/hold-area.js';
import { launchRatioReached, WAVE_GATHER_TICKS } from '../military/plan.js';
import type { ArmyPoints } from '../military/points.js';
import { seaRouteOf } from '../sea-route.js';

const SECONDS_PER_MINUTE = 60;

/** What a plan changes about the army, owner ruling for the direction, authored for the figures. */
export interface PlanTuning {
  /** Waves march once own points reach this share of the target owner's believed points. */
  readonly launchRatio: Share;
  /** Multiplies the difficulty's army floor share. */
  readonly floorShare: Share;
  /** Of the difficulty's army cap, the part a seat that drafts to its cap drafts to. */
  readonly draftCapShare: Share;
  /** How sparse the tower ring stands, in percent: the ring's defence wants scale by its inverse, so
   *  below 100 rings more towers (`build-order/tower-defence.ts`). */
  readonly towerRadiusPct: number;
}

const WHOLE: Share = { num: 1, den: 1 };

/** Owner ruling: an aggressive seat attacks more often, from a smaller edge, with more army and fewer
 *  towers; a defensive one attacks only from a clear edge and rings more towers. Balanced keeps the
 *  parity launch the computer player had before plans. */
export const PLAN_TUNING: Readonly<Record<MilitaryPlan, PlanTuning>> = {
  aggressive: {
    launchRatio: { num: 4, den: 5 },
    floorShare: { num: 3, den: 2 },
    draftCapShare: WHOLE,
    towerRadiusPct: 120,
  },
  defensive: {
    launchRatio: { num: 3, den: 2 },
    floorShare: WHOLE,
    draftCapShare: { num: 4, den: 5 },
    towerRadiusPct: 80,
  },
  harasser: {
    launchRatio: WHOLE,
    floorShare: WHOLE,
    draftCapShare: { num: 9, den: 10 },
    towerRadiusPct: 100,
  },
  balanced: {
    launchRatio: WHOLE,
    floorShare: WHOLE,
    draftCapShare: { num: 9, den: 10 },
    towerRadiusPct: 100,
  },
};

/** How a plan holds an area the map rewards holding (`military/operations/hold.ts`). */
export interface HoldTuning {
  /** Of the free men past the home floor, the share a hold sets out with; it takes more when the defence
   *  it believes at the area needs them. */
  readonly spareShare: Share;
}

/** Owner ruling: the hold is a seat's main offensive use of its army when the map rewards one; an
 *  aggressive seat sets out with more of its spare men, a defensive one with fewer. The shares are
 *  authored. */
export const HOLD_TUNING: Readonly<Record<MilitaryPlan, HoldTuning>> = {
  aggressive: { spareShare: WHOLE },
  defensive: { spareShare: { num: 1, den: 2 } },
  harasser: { spareShare: { num: 2, den: 3 } },
  balanced: { spareShare: { num: 3, den: 4 } },
};

/** Every how many of a seat's decisions its posture is reviewed (authored): 12 s at the 4 s beat, quick
 *  enough to call an army home before a forecast attack lands. */
export const POSTURE_REVIEW_EVERY_DECISIONS = 3;
/** How many reviews in a row a calm change of posture must win (authored); a forecast attack or a raid on
 *  the settlement switches at once. */
export const POSTURE_SWITCH_REVIEWS = 2;
/** How long before a forecast scripted attack the seat prepares (authored): two wave gather windows,
 *  enough to call a marching wave home and draft. Mroczny_las' first wave lands at minute 25. */
export const PREPARE_LEAD_TICKS = 2 * WAVE_GATHER_TICKS;
/** How long past an exact forecast tick the seat still prepares (authored): the attackers walk in. */
export const THREAT_ARRIVAL_GRACE_TICKS = 2 * SECONDS_PER_MINUTE * TICKS_PER_SECOND;
/** An enemy outmatches the seat from this share of its points (authored: "clearly exceeds"), and keeps
 *  it defending while above {@link DEFEND_HOLD_RATIO}. */
export const DEFEND_RATIO: Share = { num: 3, den: 2 };
export const DEFEND_HOLD_RATIO: Share = { num: 6, den: 5 };
/** An attacking seat keeps attacking down to this share of its plan's launch edge (authored). */
export const ATTACK_HOLD_SHARE: Share = { num: 9, den: 10 };
/** A seat that prepares or defends keeps this much more of its floor (authored). */
export const HOLD_FLOOR_SHARE: Share = { num: 5, den: 4 };

/** The seat's plan, drawn once. The hook for a later lobby or map setting. */
export function drawMilitaryPlan(ctx: SystemContext): MilitaryPlan {
  return MILITARY_PLANS[ctx.rng.int(MILITARY_PLANS.length)] ?? 'balanced';
}

/** What a posture review reads, gathered by {@link postureInputsOf}. */
export interface PostureInputs {
  readonly ownPoints: number;
  readonly targetOwner: number | null;
  readonly targetPoints: number | null;
  readonly strongestPoints: number | null;
  readonly threatInTicks: number | null;
  readonly underAttack: boolean;
  readonly raidTargetKnown: boolean;
  /** The map rewards the seat for holding an area it can walk to and no friend holds ({@link holdAimOf}). */
  readonly holdAimed: boolean;
}

/**
 * The posture the inputs argue for: defend under a raid, else prepare inside a forecast attack's lead
 * time, else defend against a clearly stronger enemy, else on a map won by holding an area prepare: the
 * army builds up at home for the hold and goes nowhere else (owner ruling: such a map is about taking the
 * area). Else attack once own points reach the plan's edge over the target's owner (harass for the
 * harasser), else harass a known raid target, else prepare while building up. `held` is the current
 * posture, which widens its own thresholds. Pure; `evidence` lists every rule that fired.
 */
export function selectPosture(
  plan: MilitaryPlan,
  inputs: PostureInputs,
  held: MilitaryPosture | null,
): MilitaryChoice {
  const fired = new Set<MilitaryRule>();
  const fire = (rule: MilitaryRule, when: boolean): boolean => {
    if (when) fired.add(rule);
    return when;
  };
  const { ownPoints, targetPoints, strongestPoints, threatInTicks } = inputs;
  const underAttack = fire('underAttack', inputs.underAttack);
  const defendRatio = held === 'defend' ? DEFEND_HOLD_RATIO : DEFEND_RATIO;
  const outmatched = fire(
    'outmatched',
    strongestPoints !== null &&
      strongestPoints > 0 &&
      launchRatioReached(strongestPoints, ownPoints, defendRatio),
  );
  const threatened = fire('forecastThreat', threatInTicks !== null && threatInTicks <= PREPARE_LEAD_TICKS);
  fire('noTarget', targetPoints === null);
  const launch = PLAN_TUNING[plan].launchRatio;
  const edge: Share =
    held === 'attack'
      ? { num: launch.num * ATTACK_HOLD_SHARE.num, den: launch.den * ATTACK_HOLD_SHARE.den }
      : launch;
  // A seat with no army attacks nobody, whatever parity an unknown target is taken at.
  const ratio = fire(
    'ratioReached',
    ownPoints > 0 && targetPoints !== null && launchRatioReached(ownPoints, targetPoints, edge),
  );
  const harasser = fire('harasserPlan', plan === 'harasser');
  const raidTarget = fire('raidTargetKnown', inputs.raidTargetKnown);
  let posture: MilitaryPosture;
  if (underAttack) posture = 'defend';
  else if (threatened) posture = 'prepare';
  else if (outmatched) posture = 'defend';
  else if (inputs.holdAimed) {
    fired.add('buildingUp');
    posture = 'prepare';
  } else if (harasser) posture = 'harass';
  else if (ratio) posture = 'attack';
  else if (raidTarget) posture = 'harass';
  else {
    fired.add('buildingUp');
    posture = 'prepare';
  }
  return {
    posture,
    evidence: MILITARY_RULES.filter((rule) => fired.has(rule)),
    ownPoints,
    targetOwner: inputs.targetOwner,
    targetPoints,
    strongestPoints,
    threatInTicks,
  };
}

/** Whether a change to `choice` takes effect without waiting out {@link POSTURE_SWITCH_REVIEWS}. */
function urgent(choice: MilitaryChoice): boolean {
  return (
    (choice.posture === 'defend' && choice.evidence.includes('underAttack')) ||
    (choice.posture === 'prepare' && choice.evidence.includes('forecastThreat'))
  );
}

/**
 * The military section after one review. The same posture refreshes its evidence; a different one replaces
 * it at once when urgent, else only once it has won {@link POSTURE_SWITCH_REVIEWS} reviews in a row.
 */
export function reviewMilitary(
  held: DeepReadonly<MilitaryStrategyState>,
  choice: MilitaryChoice,
  tick: number,
): MilitaryStrategyState {
  if (choice.posture === held.posture) {
    return { ...choice, plan: held.plan, decidedAt: held.decidedAt, challenger: null };
  }
  const reviews = (held.challenger?.posture === choice.posture ? held.challenger.reviews : 0) + 1;
  if (urgent(choice) || reviews >= POSTURE_SWITCH_REVIEWS) {
    return { ...choice, plan: held.plan, decidedAt: tick, challenger: null };
  }
  return {
    posture: held.posture,
    evidence: [...held.evidence],
    ownPoints: choice.ownPoints,
    targetOwner: choice.targetOwner,
    targetPoints: choice.targetPoints,
    strongestPoints: choice.strongestPoints,
    threatInTicks: choice.threatInTicks,
    plan: held.plan,
    decidedAt: held.decidedAt,
    challenger: { posture: choice.posture, reviews },
  };
}

/** The first military section of a seat: its plan drawn and its posture chosen with nothing held. */
export function firstMilitary(world: World, ctx: SystemContext, seat: number): MilitaryStrategyState {
  const plan = drawMilitaryPlan(ctx);
  const choice = selectPosture(plan, postureInputsOf(world, ctx, seat), null);
  return { ...choice, plan, decidedAt: ctx.tick, challenger: null };
}

/** The owner of the headquarters the seat's sea route sails for ({@link seaRouteOf}) while it is an enemy:
 *  a seat whose rivals all lie over the sea weighs its landing against him. */
function seaTargetOwner(world: World, ctx: SystemContext, seat: number): number | null {
  const owner = seaRouteOf(world, ctx, seat)?.headquarters.owner;
  return owner !== undefined && diplomacyStance(world, seat, owner) === 'enemy' ? owner : null;
}

/**
 * The seat's posture inputs: own points, the believed points of its campaign target's owner (the one over
 * the sea when the land holds none) and of its
 * strongest enemy (a guardian that never leaves the area the seat holds for is no threat to its home),
 * the nearest forecast scripted attack on it, a raid on its settlement now, and whether it has seen an
 * enemy building. Costs the campaign target pick and the enemies' fighters.
 */
export function postureInputsOf(world: World, ctx: SystemContext, seat: number): PostureInputs {
  const own = ownArmyPoints(world, ctx, seat).points;
  const terrain = ctx.terrain;
  let targetOwner: number | null = null;
  let underAttack = false;
  if (terrain !== undefined) {
    const barracks = seatBarracksOf(world, ctx, seat);
    targetOwner =
      barracks === null
        ? null
        : (campaignObjective(world, ctx, terrain, seat, interactionCell(world, ctx, terrain, barracks))
            ?.owner ?? seaTargetOwner(world, ctx, seat));
    const owned = ownedBuildings(world, seat);
    underAttack =
      raidOnTheSettlement(world, ctx, terrain, owned, seatRaiders(world, ctx, terrain, seat)) !== null;
  }
  return {
    ownPoints: own,
    targetOwner,
    targetPoints: targetOwner === null ? null : believedDefendingPoints(world, ctx, seat, targetOwner, own),
    strongestPoints: strongestBelievedEnemy(world, ctx, seat, stayingGuardians(world, ctx, seat)).points,
    threatInTicks: nearestThreatIn(world, ctx, seat),
    underAttack,
    raidTargetKnown: believedEnemyBuildings(world, seat).some((b) => b.seenAt !== NEVER_SEEN),
    holdAimed: terrain !== undefined && holdAimOf(world, ctx, terrain, seat),
  };
}

/** Whether `seat` builds up for a hold: the map rewards it for holding an area with a spot on its home's
 *  land, and no friend holds that area already. Costs the friends' people and the enemies' fighters. */
export function holdAimOf(world: World, ctx: SystemContext, terrain: TerrainGraph, seat: number): boolean {
  const area = holdAreaOf(ctx, seat);
  if (area === null) return false;
  const start = mapBriefOf(world)?.seats.find((s) => s.player === seat);
  if (start === undefined) return false;
  const land = terrain.componentOf(terrain.nodeAtClamped(start.hx, start.hy));
  return postOf(terrain, area, land) !== null && !friendHoldsArea(world, ctx, seat, area);
}

/** Ticks until the nearest forecast scripted attack on `seat` by an enemy or an unknown owner: 0 inside a
 *  window or within {@link THREAT_ARRIVAL_GRACE_TICKS} past an exact tick; null for none ahead. A
 *  conditional trigger has no forecast tick and is left out (gap: it waits on world state). */
export function nearestThreatIn(world: World, ctx: SystemContext, seat: number): number | null {
  const territory = seatTerritoryOf(mapBriefOf(world), seat);
  if (territory === null) return null;
  let nearest: number | null = null;
  for (const threat of seatMapIntentOf(ctx, seat, territory).threats) {
    if (threat.player !== null && diplomacyStance(world, seat, threat.player) !== 'enemy') continue;
    const inTicks = threatInTicks(threat, ctx.tick);
    if (inTicks !== null && (nearest === null || inTicks < nearest)) nearest = inTicks;
  }
  return nearest;
}

function threatInTicks(threat: SeatThreat, tick: number): number | null {
  const trigger = threat.trigger;
  if (trigger.kind === 'atTick') {
    if (tick <= trigger.tick) return trigger.tick - tick;
    return tick - trigger.tick <= THREAT_ARRIVAL_GRACE_TICKS ? 0 : null;
  }
  if (trigger.kind === 'window') {
    if (tick < trigger.fromTick) return trigger.fromTick - tick;
    return tick <= trigger.toTick ? 0 : null;
  }
  return null;
}

/** What the posture and plan tell the execution modules. */
export interface MilitaryOrders {
  readonly plan: MilitaryPlan | null;
  readonly posture: MilitaryPosture | null;
  /** Null: no wave marches. Else waves march once own points reach this share of the target's. */
  readonly launchRatio: Share | null;
  /** The army stays at home: no wave out, a marching one called back. */
  readonly holdHome: boolean;
  /** Raids on enemy gatherers may run (`military/operations/raid.ts`). */
  readonly raidsAllowed: boolean;
  /** The raids that run are the seat's periodic flank raids, not its harassing posture's, so they wait the
   *  longer interval between them. */
  readonly flankRaids: boolean;
  /** Null: no hold may run. Else a hold on an area the map rewards holding may, with these figures. */
  readonly hold: HoldTuning | null;
  /** Multiplies the difficulty's army floor share. */
  readonly floorShare: Share;
  /** Of the difficulty's army cap, the part a seat that drafts to its cap drafts to. */
  readonly draftCapShare: Share;
  /** For the build order's tower lanes: how sparse they stand, in percent (`PlanTuning.towerRadiusPct`). */
  readonly towerRadiusPct: number;
  /** The army floor may call gatherers of goods in comfortable stock to arms: the seat prepares against a
   *  forecast attack within its lead (`workforce/garrison.ts`). */
  readonly callsGatherers: boolean;
}

/** A seat with no military section yet: the parity launch and authored figures it had before plans. */
const UNDECIDED: MilitaryOrders = {
  plan: null,
  posture: null,
  launchRatio: WHOLE,
  holdHome: false,
  raidsAllowed: false,
  flankRaids: false,
  hold: null,
  floorShare: WHOLE,
  draftCapShare: WHOLE,
  towerRadiusPct: PLAN_TUNING.balanced.towerRadiusPct,
  callsGatherers: false,
};

/** The execution's reading of `seat`'s military section. */
export function militaryOrdersOf(world: World, seat: number): MilitaryOrders {
  const carrier = aiControlEntity(world, seat);
  const strategy = carrier === null ? undefined : world.tryGet(carrier, ComputerStrategy);
  if (strategy === undefined) return UNDECIDED;
  const { military } = strategy;
  const flankSeat = computerProfileOf(world, seat).flankRaids && strategy.economy.archetype !== 'islands';
  return ordersFor(military.plan, military.posture, military.evidence, flankSeat);
}

/** Whether a seat that flank-raids may send one in `posture` (owner ruling): not while it defends (under
 *  attack or outmatched) nor while it prepares against a forecast attack. */
function flankRaidsIn(posture: MilitaryPosture, evidence: readonly MilitaryRule[]): boolean {
  if (posture === 'defend') return false;
  return !(posture === 'prepare' && evidence.includes('forecastThreat'));
}

/** The orders of `plan` in `posture`, with the `evidence` that put the seat in it. `flankSeat`: the seat
 *  sends periodic flank raids (`difficulty.ts`, never from an island start). */
export function ordersFor(
  plan: MilitaryPlan,
  posture: MilitaryPosture,
  evidence: readonly MilitaryRule[] = [],
  flankSeat = false,
): MilitaryOrders {
  const tuning = PLAN_TUNING[plan];
  const holdHome = posture === 'defend' || posture === 'prepare';
  const flank = flankSeat && posture !== 'harass' && flankRaidsIn(posture, evidence);
  return {
    plan,
    posture,
    launchRatio: holdHome ? null : tuning.launchRatio,
    holdHome,
    raidsAllowed: posture === 'harass' || flank,
    flankRaids: flank,
    hold: holdsIn(plan, posture, evidence) ? HOLD_TUNING[plan] : null,
    floorShare: holdHome
      ? {
          num: tuning.floorShare.num * HOLD_FLOOR_SHARE.num,
          den: tuning.floorShare.den * HOLD_FLOOR_SHARE.den,
        }
      : tuning.floorShare,
    draftCapShare: tuning.draftCapShare,
    towerRadiusPct: tuning.towerRadiusPct,
    callsGatherers: posture === 'prepare' && evidence.includes('forecastThreat'),
  };
}

/** Whether `plan` holds an area in `posture`: never while a clearly stronger enemy or a forecast attack
 *  keeps the army home. A raid on the settlement alone leaves a hold out there (the home defence takes the
 *  men at home); a new one waits it out (`military/operations/hold.ts`). Every plan holds while it builds
 *  up, which on a map won by holding is building up for the hold; a defensive plan never while it
 *  harasses. */
function holdsIn(plan: MilitaryPlan, posture: MilitaryPosture, evidence: readonly MilitaryRule[]): boolean {
  switch (posture) {
    case 'defend':
      return !evidence.includes('outmatched');
    case 'prepare':
      return !evidence.includes('forecastThreat');
    case 'harass':
      return plan !== 'defensive';
    case 'attack':
      return true;
  }
}

/** A seat's army as its posture review reads it, for a debug view. */
export interface SeatMilitaryView {
  readonly orders: MilitaryOrders;
  readonly own: ArmyPoints;
  readonly strongestEnemy: BelievedArmy;
  /** {@link nearestThreatIn}. */
  readonly threatInTicks: number | null;
}

export function seatMilitaryViewOf(world: World, ctx: SystemContext, seat: number): SeatMilitaryView {
  return {
    orders: militaryOrdersOf(world, seat),
    own: ownArmyPoints(world, ctx, seat),
    strongestEnemy: strongestBelievedEnemy(world, ctx, seat),
    threatInTicks: nearestThreatIn(world, ctx, seat),
  };
}
