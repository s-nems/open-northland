import {
  Age,
  AttackOrder,
  Building,
  Engagement,
  hasMissionBehaviour,
  isWildlife,
  MISSION_BEHAVIOUR,
  MoveGoal,
  Owner,
  Palisade,
  Person,
  type SettlerIdentity,
  Stance,
  Vehicle,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { isTravelling } from '../movement/nav-state.js';
import { REFERENCE_STEP_TICKS } from '../movement/system.js';
import {
  isAnimalTribe,
  isFighterJob,
  isHunterJob,
  isRangedWeapon,
  MILITARY_MODE,
  type MilitaryMode,
  stanceMode,
} from '../readviews/index.js';
import { hexNodeDistance } from '../spatial/metric.js';
import { entityNode } from '../spatial/nodes.js';
import { onStride, REPATH_CADENCE } from './chase.js';
import type { SearchMetric } from './combat-grid.js';
import type { CombatIndex } from './combat-index.js';
import { hunterEngageSpec } from './hunting/index.js';
import type { Crowding, OwnClaims, Side } from './melee-slots.js';
import type { CombatPass } from './pass.js';
import { combatTargetNode, targetReachable } from './target-node.js';
import {
  ANIMAL_AGGRO_RADIUS_NODES,
  isPriorityCombatTarget,
  isValidTarget,
  SIGHT_RADIUS_NODES,
  strikeRank,
  turnsAsideUnder,
  WILD_VICTIM_TIERS,
  wildPursuit,
} from './targeting.js';
import { givenUpTargetVeto } from './unreachable-targets.js';
import { bandNodeCount, type WeaponBand, withinBand } from './weapon-band.js';
import type { ArmedWith } from './weapons.js';

// Re-exported so the combat modules keep one import site for the stance ladder.
export { stanceMode };

/** DEFEND stance - how far (map points) from its anchor a defender looks for an enemy. Original behavior.
 *  The pick ranks what it finds by distance from the defender, where the original ranks it from the anchor
 *  (approximation: they differ only while the defender stands off its anchor). */
export const DEFEND_RADIUS_NODES = 18;

/** DEFEND stance - how far (map points) from its anchor an enemy a defender already holds may go before it
 *  lets it go and walks back. Original behavior. */
export const DEFEND_LEASH_NODES = 40;

/** IGNORE stance - how far (map points) from its anchor an enemy a fighter already holds may go before it
 *  lets it go and walks back. Original behavior; the original also drops one nearer its anchor than the
 *  weapon's near reach, left out here as plainly odd. */
export const IGNORE_LEASH_NODES = 18;

/** The behaviour bits that keep a human out of a wild animal's victim search. */
const ANIMAL_BLIND_BEHAVIOUR = MISSION_BEHAVIOUR.INVULNERABLE | MISSION_BEHAVIOUR.HIDDEN_FROM_ANIMALS;

export interface CombatantStance {
  /** Whether the unit has an {@link Owner}; an unowned combatant carries no {@link Stance}. */
  readonly owned: boolean;
  /** Whether an explicit {@link AttackOrder} is in flight - it overrides `mode`'s auto-behavior. */
  readonly ordered: boolean;
  /** The {@link MILITARY_MODE} the unit acts under, or null for an unowned combatant. */
  readonly mode: MilitaryMode | null;
  /** The tower the unit is manning, or null. A garrison shoots from cover and never leaves, so the post
   *  overrides whatever `mode` would otherwise do. */
  readonly post: Entity | null;
}

/** The anchor a DEFEND or IGNORE unit guards: the {@link Stance}'s captured `anchorCell`, falling back to
 *  `here` when it carries none. */
function stanceAnchor(world: World, e: Entity, here: NodeId): NodeId {
  return world.tryGet(e, Stance)?.anchorCell ?? here;
}

/** The callbacks and spec belong to one synchronous combat pass; no caller retains them beyond a
 * unit's turn. Hunter subqueries use their own prey callbacks and never replace this seeker's input. */
export class EngagementSpecs {
  private input:
    | {
        e: Entity;
        here: NodeId;
        attacker: SettlerIdentity;
        weapon: ArmedWith;
        bank: number;
        givenUp: ((t: Entity) => boolean) | undefined;
        anchor: NodeId;
        kind: 'advance' | 'post' | 'defend' | 'ignore';
      }
    | undefined;
  private readonly reachable = (t: Entity): boolean => {
    const i = this.current();
    return targetReachable(this.world, this.ctx, this.terrain, i.here, i.weapon, t, i.bank);
  };
  private readonly hostile = (t: Entity): boolean => {
    const i = this.current();
    return isValidTarget(this.world, this.ctx, i.e, i.attacker, t);
  };
  private readonly inBand = (t: Entity): boolean => {
    const i = this.current();
    return withinBand(
      i.weapon,
      hexNodeDistance(this.terrain, i.here, combatTargetNode(this.world, this.ctx, this.terrain, i.here, t)),
    );
  };
  // Original behavior: the search has no sight or fog check; hostility (war only for two players) and
  // reach decide.
  private readonly advanceAccept = (t: Entity): boolean => {
    const i = this.current();
    return (
      this.hostile(t) && (i.givenUp === undefined || !i.givenUp(t) || this.inBand(t)) && this.reachable(t)
    );
  };
  // Original behavior, unconfirmed against the running original: a wild animal looking for a victim
  // passes over a human the map made invulnerable or hid from animals; one it already holds it keeps.
  private readonly wildAccept = (t: Entity): boolean =>
    !hasMissionBehaviour(this.world, t, ANIMAL_BLIND_BEHAVIOUR) && this.advanceAccept(t);
  private readonly accept = (t: Entity): boolean => {
    if (this.world.has(t, Age)) return false;
    const i = this.current();
    if (
      i.kind === 'defend' &&
      hexNodeDistance(this.terrain, i.anchor, entityNode(this.world, this.terrain, t)) > DEFEND_RADIUS_NODES
    )
      return false;
    if (i.kind === 'ignore' && !this.inBand(t)) return false;
    return this.advanceAccept(t);
  };
  // A held hostile stays the target until its stance leash or reach rejects it.
  private readonly keep = (t: Entity): boolean => {
    const i = this.current();
    if (i.kind === 'post')
      return (
        this.hostile(t) &&
        this.reachable(t) &&
        inReachOf(this.terrain, this.world, this.ctx, i.here, t, i.weapon.maxRange)
      );
    // Hostility first: it also drops a target with no position, such as a rider inside a vehicle.
    if (!this.hostile(t)) return false;
    if (
      i.kind === 'ignore' &&
      hexNodeDistance(this.terrain, i.anchor, entityNode(this.world, this.terrain, t)) > IGNORE_LEASH_NODES
    )
      return false;
    if (
      i.kind === 'defend' &&
      hexNodeDistance(this.terrain, i.anchor, entityNode(this.world, this.terrain, t)) > DEFEND_LEASH_NODES
    )
      return false;
    return this.reachable(t);
  };

  private readonly lowPriority = (t: Entity): boolean => this.index.isLowPriorityBuilding(t);
  private spec:
    | {
        accept: (t: Entity) => boolean;
        minDist: number;
        searchRadius: number;
        player: number | null;
        lowPriority: (t: Entity) => boolean;
        lock: null;
        defend: { anchorCell: NodeId; leash: number; hold: boolean } | null;
        hold: {
          keep: (t: Entity) => boolean;
          band: ArmedWith;
          contact: boolean;
          look: WeaponBand;
          priorityTarget: (t: Entity) => boolean;
        };
      }
    | undefined;
  private readonly look = { minRange: 0, maxRange: 0 };
  private readonly priorityTarget = (t: Entity): boolean =>
    isPriorityCombatTarget(this.world, this.ctx, t, this.index.firingNow) && this.accept(t);
  private leash: NonNullable<NonNullable<EngagementSpecs['spec']>['defend']> | undefined;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly terrain: TerrainGraph,
    private readonly index: CombatIndex,
  ) {}

  private current(): NonNullable<EngagementSpecs['input']> {
    if (this.input === undefined) throw new Error('engagement spec used before its unit turn');
    return this.input;
  }

  forUnit(
    e: Entity,
    here: NodeId,
    stance: CombatantStance,
    attacker: SettlerIdentity,
    weapon: ArmedWith,
  ): EngageSpec {
    const { world, ctx, terrain, index } = this;
    const { owned, ordered } = stance;
    const viewer = owned ? world.tryGet(e, Owner)?.player : undefined;
    const bank = terrain.isWalkable(here) ? terrain.componentOf(here) : -1;
    const givenUp = stance.post === null ? givenUpTargetVeto(world, ctx, e) : undefined;
    const anchor = stanceAnchor(world, e, here);
    // A posted fighter acquires only within its boosted weapon band, regardless of stance.
    const kind =
      stance.post !== null
        ? 'post'
        : owned && !ordered && stance.mode === MILITARY_MODE.DEFEND
          ? 'defend'
          : owned &&
              !ordered &&
              stance.mode === MILITARY_MODE.IGNORE &&
              isFighterJob(ctx.content, attacker.jobType)
            ? 'ignore'
            : 'advance';
    this.input ??= { e, here, attacker, weapon, bank, givenUp, anchor, kind };
    const input = this.input;
    input.e = e;
    input.here = here;
    input.attacker = attacker;
    input.weapon = weapon;
    input.bank = bank;
    input.givenUp = givenUp;
    input.anchor = anchor;
    input.kind = kind;
    if (
      owned &&
      stance.post === null &&
      !ordered &&
      stance.mode === MILITARY_MODE.IGNORE &&
      isHunterJob(ctx.content, attacker.jobType)
    ) {
      return hunterEngageSpec(
        world,
        ctx,
        terrain,
        index,
        e,
        here,
        attacker.jobType,
        givenUp,
        weapon.minRange,
        SIGHT_RADIUS_NODES,
      );
    }
    if (owned || kind === 'post') {
      this.spec ??= {
        accept: this.accept,
        minDist: 0,
        searchRadius: 0,
        player: null,
        lowPriority: this.lowPriority,
        lock: null,
        defend: null,
        hold: {
          keep: this.keep,
          band: weapon,
          contact: false,
          look: this.look,
          priorityTarget: this.priorityTarget,
        },
      };
      const spec = this.spec;
      if (kind === 'defend' || kind === 'ignore') {
        this.leash ??= { anchorCell: anchor, leash: 0, hold: true };
        this.leash.anchorCell = anchor;
        this.leash.leash = (kind === 'defend' ? DEFEND_LEASH_NODES : IGNORE_LEASH_NODES) + weapon.maxRange;
        spec.defend = this.leash;
      } else spec.defend = null;
      // Original behavior: advancing acquisition includes the bow's dead zone; IGNORE strikes in place.
      spec.minDist = kind === 'post' || kind === 'ignore' ? weapon.minRange : 0;
      spec.searchRadius =
        kind === 'post' || kind === 'ignore'
          ? weapon.maxRange
          : kind === 'defend'
            ? hexNodeDistance(terrain, here, anchor) + DEFEND_RADIUS_NODES
            : SIGHT_RADIUS_NODES;
      spec.player = isHunterJob(ctx.content, attacker.jobType) ? null : (viewer ?? null);
      spec.hold.band = weapon;
      // A step past the band takes the enemy about to step into it; a garrison never steps.
      this.look.minRange = weapon.minRange;
      this.look.maxRange = kind === 'post' ? weapon.maxRange : weapon.maxRange + 1;
      spec.hold.contact = stance.post === null && !isRangedWeapon(weapon.weapon);
      return spec;
    }
    const minDist = weapon.minRange;
    const advanceNear = 0;
    const player = null;
    const lowPriorityBuildings = (t: Entity): boolean => index.isLowPriorityBuilding(t);
    const advanceAccept = this.advanceAccept;
    // An unowned hostile animal advances on what its herd takes up; any other unowned combatant (a scenario
    // civ) swings in place, its search capped at weapon reach.
    if (isAnimalTribe(ctx.content, attacker.tribe)) {
      const pursuit = wildPursuit(world, ctx, terrain, e, here);
      const wild = { minDist: advanceNear, player, animalSeeker: true, lowPriority: lowPriorityBuildings };
      switch (pursuit.kind) {
        case 'hold':
          if (pursuit.retargetAround === undefined) {
            return { ...wild, ...NO_SEARCH, lock: { target: pursuit.target }, defend: null };
          }
          return {
            ...wild,
            accept: this.wildAccept,
            searchRadius: ANIMAL_AGGRO_RADIUS_NODES,
            searchCenter: pursuit.retargetAround,
            lock: { target: pursuit.target },
            defend: null,
          };
        case 'search':
          return {
            ...wild,
            accept: this.wildAccept,
            searchRadius: ANIMAL_AGGRO_RADIUS_NODES,
            searchCenter: pursuit.center,
            lock: null,
            defend: null,
          };
        case 'idle':
          return { ...wild, ...NO_SEARCH, lock: null, defend: null };
      }
    }
    return {
      accept: advanceAccept,
      minDist,
      searchRadius: weapon.maxRange,
      player,
      lowPriority: lowPriorityBuildings,
      lock: null,
      defend: null,
    };
  }
}

/** A search that admits nothing, over the seeker's own node alone. */
const NO_SEARCH = { accept: (): boolean => false, searchRadius: 0 } as const;

/** Whether `t`'s combat node lies within `reach` map points of `here`. */
function inReachOf(
  terrain: TerrainGraph,
  world: World,
  ctx: SystemContext,
  here: NodeId,
  t: Entity,
  reach: number,
): boolean {
  return hexNodeDistance(terrain, here, combatTargetNode(world, ctx, terrain, here, t)) <= reach;
}

export interface EngageSpec {
  /** The nearest search's per-candidate hostility/predation filter. */
  readonly accept: (t: Entity) => boolean;
  /** Near reach - the search ignores anything closer (a ranged weapon's dead zone). */
  readonly minDist: number;
  /** Far reach - how far the unit spots a target to swing at / advance on. Both reaches count map points,
   *  and the search orders its candidates by them. */
  readonly searchRadius: number;
  /** The seeker's player for the {@link CombatIndex.othersWithin} early-out; null when the seeker must
   *  never skip the search - an unowned one, or a hunter in any stance. */
  readonly player: number | null;
  /** A hostile wild animal seeking - gates on {@link CombatIndex.civsWithin} instead. */
  readonly animalSeeker?: boolean;
  /** Where the search is centred and its candidates ranked from when not the seeker's own node: a wild
   *  herd leader's stay point. Beside a `lock`, the wild leader turns to a victim nearer it than the lock. */
  readonly searchCenter?: NodeId;
  /** A hunter seeking prey, whose acquisition rests after a pass that took none. */
  readonly preySeeker?: boolean;
  /** The deprioritized tier among accepted targets, searched only when the primary tier finds nothing in
   *  sight. It splits RAW search candidates ahead of {@link EngageSpec.accept}, so it must stay total
   *  and pure over any indexed entity - a friendly unit, an own building, a carcass. */
  readonly lowPriority: (t: Entity) => boolean;
  /** Target commitment: non-null for a stance that holds one target across ticks instead of re-acquiring
   *  the nearest candidate. `target` is the live hold, null when nothing is committed yet. */
  readonly lock: { readonly target: Entity | null } | null;
  /** Anchor leash: the chase never walks past `leash` map points of `anchorCell`; null when the chase is
   *  unbounded. `hold` walks the unit back to the anchor with no target in sight, false hands it
   *  back to the economy. */
  readonly defend: {
    readonly anchorCell: NodeId;
    readonly leash: number;
    readonly hold: boolean;
  } | null;
  /** Present for an owned combatant that holds its enemy across ticks ({@link Engagement.target}) and picks
   *  a new one the original's way; `keep` says whether a held enemy is still held, and `band` is the reach
   *  it strikes one from. */
  readonly hold?: {
    readonly keep: (t: Entity) => boolean;
    readonly band: WeaponBand;
    /** A melee fighter on its feet, the only kind that forms a front: it weighs crowding in its pick, turns
     *  to a less crowded enemy after a blow and steps along a full front. False for a bow or a garrison,
     *  which keep the original's plain nearest pick and random draw. */
    readonly contact: boolean;
    /** Retarget band plus one approach step; a garrison searches only its weapon band. */
    readonly look: WeaponBand;
    /** `accept` narrowed to first-tier combat targets. */
    readonly priorityTarget: (t: Entity) => boolean;
  };
}

/**
 * The enemy this combatant fights this tick with its reach from `here` in map points, or null. An
 * {@link AttackOrder} focus and a live `spec.lock` resolve ahead of the nearest search; a fighter's own
 * breach yields to a primary-tier target inside `weapon`'s band, and any other order that lets its fighter
 * turn aside to a higher-ranked enemy ({@link asideFromOrder}). Otherwise the nearest target `spec.accept`
 * admits within `[spec.minDist, spec.searchRadius]`, with the `spec.lowPriority` tier searched only when the
 * primary tier finds nothing in sight. `moving` is the swing gate's own reading of whether the unit still
 * walks, so the held enemy is weighed against its neighbours on exactly the ticks a swing could start.
 */
export function resolveTarget(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  self: Entity,
  here: NodeId,
  spec: EngageSpec,
  weapon: WeaponBand,
  moving: boolean,
): { target: Entity; dist: number } | null {
  const { index } = pass;
  // The engage ladder already dropped an order whose target died or stopped being hostile this tick. An
  // ordered target is chased regardless of sight, so its real distance is measured, uncapped by the band.
  const order = world.tryGet(self, AttackOrder);
  if (order !== undefined) {
    const x = terrain.xOf(here);
    const y = terrain.yOf(here);
    // An enemy within a breaker's reach is fought first, and the wall taken up again once it is gone.
    const rival =
      order.breach?.enemy === undefined
        ? null
        : index.nearest(
            x,
            y,
            weapon.minRange,
            weapon.maxRange,
            (t) => !spec.lowPriority(t) && spec.accept(t),
            spec.player,
            SEARCH_METRIC,
          );
    if (rival !== null) return { target: rival.entity, dist: rival.distance };
    if (spec.hold !== undefined && turnsAsideUnder(world, ctx, order, index.firingNow)) {
      const aside = asideFromOrder(
        world,
        ctx,
        terrain,
        pass,
        self,
        here,
        spec,
        spec.hold,
        order.target,
        moving,
      );
      if (aside !== null) return aside;
    }
    return focusedOn(world, ctx, terrain, here, order.target);
  }
  if (spec.hold !== undefined) {
    return heldOrPicked(world, ctx, terrain, pass, self, here, spec, spec.hold, moving);
  }
  const x = terrain.xOf(spec.searchCenter ?? here);
  const y = terrain.yOf(spec.searchCenter ?? here);
  const locked = spec.lock?.target ?? null;
  if (locked !== null) {
    // A commitment ignores `minDist`: prey that closes inside the weapon's dead zone is backed off by the
    // chase, not dropped. The tier rule still outranks it, so a hold on the deprioritized tier yields to
    // any primary-tier target in sight.
    const preempt = spec.lowPriority(locked)
      ? index.nearest(
          x,
          y,
          spec.minDist,
          spec.searchRadius,
          (t) => !spec.lowPriority(t) && spec.accept(t),
          spec.player,
          SEARCH_METRIC,
        )
      : null;
    if (preempt !== null) return focusedOn(world, ctx, terrain, here, preempt.entity);
    if (spec.animalSeeker === true && spec.searchCenter !== undefined) {
      const nearer = nearerWildVictim(world, ctx, terrain, pass, spec, spec.searchCenter, locked);
      if (nearer !== null) return focusedOn(world, ctx, terrain, here, nearer);
    }
    return focusedOn(world, ctx, terrain, here, locked);
  }
  // Idle early-out (perf-only): when the coarse presence grid proves no member of a player at war with the
  // seeker either way, and no unowned one but passive wildlife, can be in the search band, both tier searches
  // would return null.
  if (spec.player !== null && !index.othersWithin(spec.player, x, y, spec.searchRadius)) return null;
  // The animal seeker's twin: no civ in the band proves both empty.
  if (spec.animalSeeker === true && !index.civsWithin(x, y, spec.searchRadius)) return null;
  // A nearer tier-2 target never preempts a tier-1 target in sight.
  const found =
    spec.animalSeeker === true
      ? pickWildVictim(world, ctx, pass, spec, x, y)
      : (pickInBand(pass, spec, x, y, 'primary') ?? pickInBand(pass, spec, x, y, 'low'));
  return found === null ? null : focusedOn(world, ctx, terrain, here, found.entity);
}

/** Every engage search counts map points, the metric weapon reach and the stances' radii share. */
const SEARCH_METRIC: SearchMetric = 'hex';

/** How many of the nearest candidates a pick draws among, and how much farther (map points) than the
 *  nearest one of them may stand. Original behavior. */
const PICK_CANDIDATES = 5;
const PICK_SPREAD_NODES = 3;

type PickTier = (world: World, ctx: SystemContext, index: CombatIndex, t: Entity) => boolean;

/** Owner rule: fighters, towers and firing buildings share the first tier. Remaining tiers preserve the original's
 *  approximate ordering: military buildings, wildlife, other people, vehicles, then other buildings. */
const PICK_TIERS: readonly PickTier[] = [
  (world, ctx, index, t) => isPriorityCombatTarget(world, ctx, t, index.firingNow),
  (world, _ctx, index, t) => world.has(t, Building) && !index.isLowPriorityBuilding(t),
  (world, _ctx, _index, t) => isWildlife(world, t),
  (world, _ctx, _index, t) => world.has(t, Person),
  (world, _ctx, _index, t) => world.has(t, Vehicle),
  (world, _ctx, _index, t) => world.has(t, Building),
];

/** The first tier can interrupt a lower-priority target. */
const COMBAT_TIER: readonly PickTier[] = PICK_TIERS.slice(0, 1);

/**
 * Owner rule: a first-tier threat interrupts a lower-priority target. Search near the weapon band
 * between blows, or across sight every REPATH_CADENCE ticks while approaching. The original keeps
 * its target until it falls; this lets a besieger answer nearby threats.
 */
function priorityTargetToTurnTo(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  self: Entity,
  here: NodeId,
  spec: EngageSpec,
  hold: NonNullable<EngageSpec['hold']>,
  asker: Asker | null,
  striking: boolean,
): { target: Entity; dist: number } | null {
  if (striking) return priorityTargetInLook(world, ctx, terrain, pass, here, spec, hold);
  if (!onStride(ctx.tick, self, REPATH_CADENCE)) return null;
  const x = terrain.xOf(here);
  const y = terrain.yOf(here);
  const found = pickByTier(world, ctx, terrain, pass, spec, asker, x, y, COMBAT_TIER);
  return found === null ? null : focusedOn(world, ctx, terrain, here, found.entity);
}

/** The nearest first-tier enemy `spec` admits within `hold.look` of `here`: one small band scan. */
function priorityTargetInLook(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  here: NodeId,
  spec: EngageSpec,
  hold: NonNullable<EngageSpec['hold']>,
): { target: Entity; dist: number } | null {
  const found = pass.index.nearest(
    terrain.xOf(here),
    terrain.yOf(here),
    hold.look.minRange,
    hold.look.maxRange,
    hold.priorityTarget,
    spec.player,
    SEARCH_METRIC,
  );
  return found === null ? null : focusedOn(world, ctx, terrain, here, found.entity);
}

/**
 * The enemy a combatant fights ahead of its order's `target` when the order lets it turn aside
 * ({@link turnsAsideUnder}): the one it already turned to while that still outranks the target
 * ({@link strikeRank}), the striker it turned on included, else a first-tier threat in its look
 * ({@link priorityTargetInLook}), between blows or every {@link REPATH_CADENCE} ticks of a walk.
 * Null takes the target up again. The order stands throughout: a chase the enemy escapes lets only that enemy go
 * (`chase.ts`).
 */
function asideFromOrder(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  self: Entity,
  here: NodeId,
  spec: EngageSpec,
  hold: NonNullable<EngageSpec['hold']>,
  target: Entity,
  moving: boolean,
): { target: Entity; dist: number } | null {
  const engaged = world.tryGet(self, Engagement)?.target;
  if (
    engaged !== undefined &&
    engaged !== target &&
    world.isAlive(engaged) &&
    hold.keep(engaged) &&
    ranksAbove(world, ctx, pass, engaged, target)
  ) {
    return focusedOn(world, ctx, terrain, here, engaged);
  }
  if (moving && !onStride(ctx.tick, self, REPATH_CADENCE)) return null;
  return priorityTargetInLook(world, ctx, terrain, pass, here, spec, hold);
}

/** Whether `a` holds a higher rank than `b` ({@link strikeRank}). */
function ranksAbove(world: World, ctx: SystemContext, pass: CombatPass, a: Entity, b: Entity): boolean {
  const firing = pass.index.firingNow;
  return strikeRank(world, ctx, a, firing) < strikeRank(world, ctx, b, firing);
}

/** `band` widened by one step past its far reach: the enemy about to step into it counts as in reach. */
function stepPastReach(band: WeaponBand): WeaponBand {
  return { minRange: band.minRange, maxRange: band.maxRange + 1 };
}

/**
 * The enemy an owned combatant fights: the one it holds while its stance still keeps it, unless a rescan
 * finds one that scores strictly better ({@link crowdedScore}). Original behavior: a fighter keeps its
 * target until it is gone or strays past its leash, and a new scan takes over only a nearer enemy. It scans
 * when it has no target, then while it walks every tenth step ({@link RESCAN_WALK_STEPS}), and never
 * between blows. A lower-priority target also yields to a first-tier threat ({@link priorityTargetToTurnTo}).
 */
function heldOrPicked(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  self: Entity,
  here: NodeId,
  spec: EngageSpec,
  hold: NonNullable<EngageSpec['hold']>,
  moving: boolean,
): { target: Entity; dist: number } | null {
  const heldTarget = world.tryGet(self, Engagement)?.target;
  const held =
    heldTarget !== undefined && world.isAlive(heldTarget) && hold.keep(heldTarget)
      ? focusedOn(world, ctx, terrain, here, heldTarget)
      : null;
  const asker: Asker | null = hold.contact
    ? {
        here,
        side: world.tryGet(self, Owner)?.player ?? null,
        band: hold.band,
        mine: { goal: world.tryGet(self, MoveGoal)?.cell, standingOn: here },
      }
    : null;
  if (
    held !== null &&
    heldTarget !== undefined &&
    !isPriorityCombatTarget(world, ctx, heldTarget, pass.index.firingNow)
  ) {
    const striking = !isTravelling(world, self) && withinBand(hold.band, held.dist);
    const priority = priorityTargetToTurnTo(
      world,
      ctx,
      terrain,
      pass,
      self,
      here,
      spec,
      hold,
      asker,
      striking,
    );
    if (priority !== null) return priority;
  }
  if (held !== null && heldTarget !== undefined && !rescanDue(world, ctx, self, held.dist, hold.band)) {
    if (asker === null || moving || !withinBand(hold.band, held.dist)) return held;
    return lessCrowdedInReach(world, ctx, terrain, pass, spec, asker, heldTarget) ?? held;
  }
  const x = terrain.xOf(here);
  const y = terrain.yOf(here);
  if (
    held === null &&
    spec.player !== null &&
    !pass.index.othersWithin(spec.player, x, y, spec.searchRadius)
  ) {
    return null;
  }
  const picked = pickByTier(world, ctx, terrain, pass, spec, asker, x, y);
  if (picked === null) return held;
  // A search hit lies at its distance to the nearest wall in the band; the reach check measures to the
  // nearest wall of all.
  const pickedAt = focusedOn(world, ctx, terrain, here, picked.entity);
  if (held === null || heldTarget === undefined) return pickedAt;
  // Owner rule: a rescan never trades the held enemy for one of a lower rank, however nearer.
  if (ranksAbove(world, ctx, pass, heldTarget, picked.entity)) return held;
  if (asker === null) return pickedAt.dist >= held.dist ? held : pickedAt;
  const heldScore = crowdedScore(world, ctx, terrain, pass, asker, heldTarget, held.dist);
  const pickedScore = crowdedScore(world, ctx, terrain, pass, asker, picked.entity, pickedAt.dist);
  return pickedScore >= heldScore ? held : pickedAt;
}

/** Who asks how crowded an enemy is: from where, for which side, striking from which band, and the cells
 *  it already holds for itself. */
interface Asker {
  readonly here: NodeId;
  readonly side: Side;
  readonly band: WeaponBand;
  readonly mine: OwnClaims;
}

/** How many walk steps a fighter takes between two looks for a nearer enemy. Original behavior. */
export const RESCAN_WALK_STEPS = 10;

/** {@link RESCAN_WALK_STEPS} in ticks: ten steps at the reference land pace of 8 ticks a step, 80 ticks,
 *  staggered by entity id. Approximation: the original counts the steps themselves, so here a walker slower
 *  than that pace looks a little more often per step and a faster one a little less, and a new enemy a look
 *  finds is walked toward from the chase's next re-path, up to {@link REPATH_CADENCE} ticks later. */
export const RESCAN_PERIOD_TICKS = RESCAN_WALK_STEPS * REFERENCE_STEP_TICKS;

/**
 * Whether a combatant holding a target `heldDist` map points off looks again this tick: every
 * {@link RESCAN_PERIOD_TICKS} while it walks, and never while it stands with the target in `band`. A unit
 * standing with its target out of reach, a second rank waiting for a side, looks every
 * {@link REPATH_CADENCE} ticks. Intentional deviation: in the original that unit would already be walking up
 * to fight from a taken side, so here it takes an enemy that steps up to it within about a step instead
 * of standing idle beside it.
 */
function rescanDue(
  world: World,
  ctx: SystemContext,
  self: Entity,
  heldDist: number,
  band: WeaponBand,
): boolean {
  if (isTravelling(world, self)) return onStride(ctx.tick, self, RESCAN_PERIOD_TICKS);
  if (withinBand(band, heldDist)) return false;
  return onStride(ctx.tick, self, REPATH_CADENCE);
}

/**
 * How many map points one friend already standing at an enemy adds to that enemy's pick score.
 * Approximation: owner rule, no counterpart in the original, which stacks every attacker on the nearest
 * enemy. Here bodies collide, so a fighter picks the enemy fewest of its own side already stand at, and
 * two lines meet as a front that the larger side wraps rather than a pile on one man.
 */
export const CROWDING_WEIGHT = 2;

/**
 * An enemy's pick score for `asker`: its distance plus {@link CROWDING_WEIGHT} for every friend already
 * standing where the asker's weapon would strike it from ({@link MeleeSlots.crowdingAround}), the asker's
 * own node not counted. A building or a vehicle is scored by distance alone: a building is besieged wall by
 * wall, not surrounded, and a vehicle is a body like it, not a fighter on foot.
 */
function crowdedScore(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  asker: Asker,
  target: Entity,
  dist: number,
): number {
  return dist + CROWDING_WEIGHT * crowdingOf(world, ctx, terrain, pass, asker, target).occupied;
}

/** {@link MeleeSlots.crowdingAround} a unit target; a building or a vehicle is never crowded out. */
function crowdingOf(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  asker: Asker,
  target: Entity,
): Crowding {
  if (world.has(target, Building) || world.has(target, Palisade) || world.has(target, Vehicle)) {
    return OPEN_CROWDING;
  }
  const at = combatTargetNode(world, ctx, terrain, asker.here, target);
  return pass.slots.crowdingAround(at, asker.band, asker.side, asker.mine);
}

const OPEN_CROWDING: Crowding = { occupied: 0, sealed: false };

/**
 * The enemy a fighter about to strike turns to instead: one within reach or a step outside it, of a kind
 * no worse than `heldTarget`, with strictly fewer bodies standing at it than the held one; among those the
 * nearest, then the lowest id. Null keeps the held one. Asked on the ticks a swing could start, so before
 * a walker's first blow and after every one, and never mid-swing, and it costs one band scan a step wider
 * than the weapon's reach, so the work follows the fighters in contact. Owner rule: the original never
 * lets go of a live target it can reach; here it is what keeps three swords off one man once the lines
 * have mixed.
 */
function lessCrowdedInReach(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  spec: EngageSpec,
  asker: Asker,
  heldTarget: Entity,
): { target: Entity; dist: number } | null {
  const heldCrowd = crowdingOf(world, ctx, terrain, pass, asker, heldTarget).occupied;
  if (heldCrowd === 0) return null;
  const { index } = pass;
  const heldRank = tierRank(world, ctx, index, heldTarget);
  const heldStrike = strikeRank(world, ctx, heldTarget, index.firingNow);
  const reach = stepPastReach(asker.band);
  const x = terrain.xOf(asker.here);
  const y = terrain.yOf(asker.here);
  const near = index.nearestFew(
    x,
    y,
    reach.minRange,
    reach.maxRange,
    (t) =>
      t !== heldTarget &&
      tierRank(world, ctx, index, t) <= heldRank &&
      strikeRank(world, ctx, t, index.firingNow) <= heldStrike &&
      spec.accept(t),
    bandNodeCount(reach), // the most distinct units the band can hold
    spec.player,
    reach.maxRange,
    SEARCH_METRIC,
  );
  let best: Entity | null = null;
  let bestCrowd = heldCrowd;
  for (const candidate of near) {
    const crowd = crowdingOf(world, ctx, terrain, pass, asker, candidate.entity).occupied;
    if (crowd < bestCrowd) {
      best = candidate.entity;
      bestCrowd = crowd;
    }
  }
  return best === null ? null : focusedOn(world, ctx, terrain, asker.here, best);
}

/**
 * The pick: the first kind in {@link PICK_TIERS} with a candidate, and among its {@link PICK_CANDIDATES}
 * nearest within {@link PICK_SPREAD_NODES} of the nearest, one at random. Original behavior. A melee
 * `asker` instead takes the lowest {@link crowdedScore} of them, drawn at random among equal scores, and
 * an enemy nobody can step up to any more only when the kind offers no other: the owner's rule.
 */
function pickByTier(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  spec: EngageSpec,
  asker: Asker | null,
  x: number,
  y: number,
  tiers: readonly PickTier[] = PICK_TIERS,
): { entity: Entity; distance: number } | null {
  for (const tier of tiers) {
    const found = pass.index.nearestFew(
      x,
      y,
      spec.minDist,
      spec.searchRadius,
      (t) => tier(world, ctx, pass.index, t) && spec.accept(t),
      PICK_CANDIDATES,
      spec.player,
      PICK_SPREAD_NODES,
      SEARCH_METRIC,
    );
    if (found.length === 0) continue;
    if (found.length === 1) return found[0] ?? null;
    if (asker === null) return found[ctx.rng.int(found.length)] ?? null;
    return leastCrowded(world, ctx, terrain, pass, asker, found);
  }
  return null;
}

/** The lowest-scoring of `found` (in ascending distance, then id), drawn at random among equal scores;
 *  sealed enemies stand aside while an open one is among them. */
function leastCrowded(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  asker: Asker,
  found: readonly { entity: Entity; distance: number }[],
): { entity: Entity; distance: number } | null {
  const scored = found.map((candidate) => {
    const crowding = crowdingOf(world, ctx, terrain, pass, asker, candidate.entity);
    return {
      candidate,
      sealed: crowding.sealed,
      score: candidate.distance + CROWDING_WEIGHT * crowding.occupied,
    };
  });
  const open = scored.filter((c) => !c.sealed);
  const pool = open.length > 0 ? open : scored;
  let best = Number.POSITIVE_INFINITY;
  for (const c of pool) best = Math.min(best, c.score);
  const ties = pool.filter((c) => c.score === best);
  const pick = ties.length === 1 ? ties[0] : ties[ctx.rng.int(ties.length)];
  return pick?.candidate ?? null;
}

/** The place of `t` in {@link PICK_TIERS}, one past the last for a target of no listed kind. */
function tierRank(world: World, ctx: SystemContext, index: CombatIndex, t: Entity): number {
  const rank = PICK_TIERS.findIndex((tier) => tier(world, ctx, index, t));
  return rank < 0 ? PICK_TIERS.length : rank;
}

/** An enemy in reach from a node, or null: what a fighter standing behind a full front asks of the free
 *  cells a step away. */
export type EnemyInReachFrom = (node: NodeId) => { entity: Entity; distance: number } | null;

/**
 * The nearest enemy `spec` admits within `band` of a node, of a kind no worse than `than` (the enemy the
 * fighter holds), so a fighter stepping along the front from one enemy fighter never turns on a nearby
 * civilian or wall. One small band scan per node asked.
 */
export function enemyInReachFrom(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  spec: EngageSpec,
  than: Entity,
  band: WeaponBand,
): EnemyInReachFrom {
  const { index } = pass;
  const heldRank = tierRank(world, ctx, index, than);
  const accept = (t: Entity): boolean => tierRank(world, ctx, index, t) <= heldRank && spec.accept(t);
  return (node) => {
    const x = terrain.xOf(node);
    const y = terrain.yOf(node);
    return index.nearest(x, y, band.minRange, band.maxRange, accept, spec.player, SEARCH_METRIC);
  };
}

type TargetTier = 'primary' | 'low';

/** One priority tier's pick from the search band: the nearest target the stance admits. */
function pickInBand(
  pass: CombatPass,
  spec: EngageSpec,
  x: number,
  y: number,
  tier: TargetTier,
): { entity: Entity; distance: number } | null {
  const wantsLowPriority = tier === 'low';
  const accept = (t: Entity): boolean => spec.lowPriority(t) === wantsLowPriority && spec.accept(t);
  return pass.index.nearest(x, y, spec.minDist, spec.searchRadius, accept, spec.player, SEARCH_METRIC);
}

/** The nearest victim `spec` and `also` admit around `x, y` in the first of {@link WILD_VICTIM_TIERS} that
 *  holds one. */
function pickWildVictim(
  world: World,
  ctx: SystemContext,
  pass: CombatPass,
  spec: EngageSpec,
  x: number,
  y: number,
  also?: (t: Entity) => boolean,
): { entity: Entity; distance: number } | null {
  for (const tier of WILD_VICTIM_TIERS) {
    const found = pass.index.nearest(
      x,
      y,
      spec.minDist,
      spec.searchRadius,
      (t) => tier(world, ctx, t) && (also === undefined || also(t)) && spec.accept(t),
      spec.player,
      SEARCH_METRIC,
    );
    if (found !== null) return found;
  }
  return null;
}

/** The victim a wild leader holding `held` turns to: the first of {@link WILD_VICTIM_TIERS} holding one
 *  nearer `center` than `held`, the nearest of it. Original behavior. */
function nearerWildVictim(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  spec: EngageSpec,
  center: NodeId,
  held: Entity,
): Entity | null {
  const x = terrain.xOf(center);
  const y = terrain.yOf(center);
  if (!pass.index.civsWithin(x, y, spec.searchRadius)) return null;
  const heldDist = hexNodeDistance(terrain, center, entityNode(world, terrain, held));
  const nearer = (t: Entity): boolean =>
    t !== held && hexNodeDistance(terrain, center, entityNode(world, terrain, t)) < heldDist;
  return pickWildVictim(world, ctx, pass, spec, x, y, nearer)?.entity ?? null;
}

/** A focused target and its real distance from `here`, uncapped by the search band - a building
 *  measured at the wall the chase closes on. */
function focusedOn(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  target: Entity,
): { target: Entity; dist: number } {
  return {
    target,
    dist: hexNodeDistance(terrain, here, combatTargetNode(world, ctx, terrain, here, target)),
  };
}
