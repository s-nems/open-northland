import type { BuildLineId, StepKey } from '../../../../components/ai/computer-player.js';
import type { JoineryRole } from '../../joinery-role.js';

/** Where a placement gravitates, on top of the always-on near-base rule; `../ground/affinity.ts` resolves
 *  each kind to a node. `resource` is the good's nearest live deposit, or the seat's store holding the
 *  most of the good once none stands. `front` is the settlement's own edge toward the nearest enemy seat,
 *  its headquarters before any other building, and toward the map centre while no enemy has a building
 *  standing; the base itself while enemies surround the seat (`../ground/front.ts`). `shore` is the nearest water beside the seat's land a ship can sail, a body that also
 *  touches the enemy's continent first; unlike the others it is a hard rule, the spot landing close
 *  enough to that water for the workshop's ship yard. */
export type PlacementAffinity =
  | { readonly kind: 'building'; readonly id: string }
  | { readonly kind: 'resource'; readonly good: string }
  | { readonly kind: 'mapCentre' }
  | { readonly kind: 'front' }
  | { readonly kind: 'shore' };

/**
 * What a step waits for while its line holds on it:
 * - `built`: a standing building of the id at that tier or above (a rising site does not count);
 * - `placedUnlessDefending`: a placed one (its site counts), unless the seat's defence comes first;
 * - `good`: the seat has discovered how to make the good;
 * - `wanted`: a step heading another line wants the good (it holds on nothing of its own, its tier is open
 *   to the seat and its bill takes the good);
 * - `noneDue`: no step heading another line is ready to place one of `buildings` (`../steps/holds.ts`);
 * - `shipPath`: the seat needs ships, for a rival over the sea or its colony (`../../sea-route.ts`), and its
 *   defence does not come first;
 * - `settlers`: the seat counts `count` settlers;
 * - `deadline`: the clock reaches `leadTicks` before the seat's military deadline
 *   (`../../military/deadline.ts`), lifted at once while its defence comes first;
 * - `tick`: the clock reaches `tick`;
 * - `filledGround`: the seat's land is built up and its store spares a lower tower (`../towers/filled-towers.ts`);
 * - `all` / `any`: every one, or any one, of `holds`.
 * A hold the seat can never meet (a building or good missing from the content, a discovery it can never
 * make, a building or the good's maker no unskipped step raises) lets the step act; within `all` only that
 * hold drops out.
 */
export type StepHold =
  | { readonly kind: 'built'; readonly building: string }
  | { readonly kind: 'placedUnlessDefending'; readonly building: string }
  | { readonly kind: 'good'; readonly good: string }
  | { readonly kind: 'wanted'; readonly good: string }
  | { readonly kind: 'noneDue'; readonly buildings: readonly string[] }
  | { readonly kind: 'shipPath' }
  | { readonly kind: 'settlers'; readonly count: number }
  | { readonly kind: 'deadline'; readonly leadTicks: number }
  | { readonly kind: 'tick'; readonly tick: number }
  | { readonly kind: 'filledGround' }
  | { readonly kind: 'all'; readonly holds: readonly StepHold[] }
  | { readonly kind: 'any'; readonly holds: readonly StepHold[] };

/** The defence a tower ring wants, in garrison seats summed over the defence circles covering a node:
 *  `village` over every building, `front` over the front's band (`../towers/tower-defence.ts`). */
export interface DefenceWants {
  readonly village: number;
  readonly front: number;
}

export type BuildOrderEntry =
  /** Place `count` buildings of the stable content id. `near` pulls the spot toward its anchors,
   *  `ground: 'plantable'` puts the footprint on sowable ground, or where none fits, beside free sowable
   *  ground (`../ground/placement.ts`). `needsResources`
   *  names the map goods the building exists to work up; an unmet entry is skipped while the map holds
   *  none of any one of them, like a collector entry. `unlessWithin` skips the entry while every one of
   *  the seat's named buildings (at that tier or above) has one of the buildings the entry counts within
   *  `radius` world-metric nodes, or while the seat has none of those; a `near` affinity on the same id
   *  then pulls the spot toward the first one lacking. `onlyWhen: 'needsShips'` skips the entry while
   *  the seat needs no ships, its rival reached by land and no colony kept (`../../sea-route.ts`),
   *  `'grassScarce'` while the seat has grass enough (`../ground/grass-reserve.ts`), `'livestock'` while the seat
   *  keeps no pair of either species (`../../herd.ts`). An entry of a grass building with no grass left
   *  for it is passed over unless `essential`, which holds its line until it stands. `belowTier` stops the
   *  count below that tier of the chain, so buildings placed straight at it never meet the entry. `role` counts only the
   *  joineries of the counted tiers holding that role (`../../joinery-role.ts`). `holdUntil` holds the line on the unmet entry,
   *  acting on nothing, until its {@link StepHold} is met. `aheadOfCrews` places the copy without waiting
   *  for the crews of those standing (`../steps/holds.ts`). `room` names the buildings that later stand
   *  beside this one: the spot is scored by the free ground around it against their footprints
   *  (`../ground/placement.ts`). `amongHomes` searches as a home does, on the far side of the base from the field
   *  farms. `core` gives the step an earned workshop's turn while no food turn waits (`../turns.ts`).
   *  `firstRank` keeps the turn of a first new kind, or the earned one, beside a rising site of its own
   *  line and when the seat owns a building of its kind, so it goes up with the bread chain's first
   *  buildings. `atUnlock` places the entry the moment its building unlocks, over the site pace and ahead
   *  of the lanes and the other lines, unless the seat is attacked (`../turns.ts`).
   *  `lockPasses` passes over the entry while its building's tier is locked instead of holding its line.
   *  `yieldsRoom` passes over an entry whose search finds no spot, a copy on a seat short of ground. */
  | {
      readonly kind: 'place';
      readonly building: string;
      readonly count: number;
      readonly near?: readonly PlacementAffinity[];
      readonly ground?: 'plantable';
      readonly needsResources?: readonly string[];
      readonly unlessWithin?: { readonly building: string; readonly radius: number };
      readonly onlyWhen?: 'needsShips' | 'grassScarce' | 'livestock';
      readonly essential?: true;
      readonly belowTier?: string;
      readonly role?: JoineryRole;
      readonly holdUntil?: StepHold;
      readonly aheadOfCrews?: true;
      readonly room?: readonly string[];
      readonly amongHomes?: true;
      readonly core?: true;
      readonly firstRank?: true;
      readonly atUnlock?: true;
      readonly lockPasses?: true;
      readonly yieldsRoom?: true;
    }
  /** Upgrade owned buildings up their `upgradeTarget` chain until `count` stand at or above the
   *  named tier, and below `belowTier` when given. `role` counts and lifts only the joineries holding that
   *  role; `onlyWhen`, `holdUntil`, `lockPasses` and `firstRank` act as a placement's. */
  | {
      readonly kind: 'upgrade';
      readonly building: string;
      readonly count: number;
      readonly belowTier?: string;
      readonly role?: JoineryRole;
      readonly onlyWhen?: 'needsShips' | 'livestock';
      readonly holdUntil?: StepHold;
      readonly lockPasses?: true;
      readonly firstRank?: true;
    }
  /** Wait for `count` (default 1) flag-bound gatherers of the good; the workforce module owns the hire
   *  and keeps at least that many. Posts past the first come out of spare men only, so its line holds
   *  here until the seat has them. A good with no live resource is skipped. `fromTick` holds the line
   *  here, hiring nobody, until the game clock reaches it, and `holdUntil` until its {@link StepHold} is
   *  met. `stockedAt` passes the entry over, its posts released, while the seat stores that many units of
   *  the good, and until it falls under half of them again once nobody gathers it. */
  | {
      readonly kind: 'collector';
      readonly good: string;
      readonly count?: number;
      readonly fromTick?: number;
      readonly holdUntil?: StepHold;
      readonly stockedAt?: number;
    }
  /** Keep the seat's defence at the `defence` wants (default `OPENING_DEFENCE`, `../towers/tower-defence.ts`): a
   *  tower wherever the defence circles leave a building or the front short. Unlike the counted entries it
   *  re-arms whenever a later building lands short, so the tower count is dynamic. A `lane` entry runs beside the lines once
   *  every counted step before it in its line stands met, and the game clock reaches `fromTick`: it holds
   *  one site of its building at a time, taken out of the clock's site count, never stalls the steps
   *  behind it, and they never wait on it. `holdUntil` holds a line's ring as a placement's. `lowerTier`
   *  raises only `building`'s own tier and lifts no standing tower. */
  | {
      readonly kind: 'towerCoverage';
      readonly building: string;
      readonly defence?: DefenceWants;
      readonly lane?: true;
      readonly fromTick?: number;
      readonly holdUntil?: StepHold;
      readonly lowerTier?: true;
    }
  /** The same rule over the seat's stores: every owned building within `radius` nodes of the base or a
   *  warehouse, so goods never travel far to a store. */
  | {
      readonly kind: 'storeCoverage';
      readonly building: string;
      readonly radius: number;
      readonly lane?: true;
      readonly fromTick?: number;
    }
  /** Keep the homes' family slots ahead of the seat's women (`../steps/housing.ts`): always a lane, its home
   *  sites paced by the seat's food stage. Unlike the coverage lanes its first site is one of the clock's
   *  sites, so it reserves none while it waits, and the further ones stand beyond the clock. `building` is
   *  the home chain's base tier: the lane raises and upgrades homes of its tiers, at most `count` of them,
   *  and a cap under its id cuts that. */
  | {
      readonly kind: 'housing';
      readonly building: string;
      readonly count: number;
    };

/** Whether `entry` is a lane running beside the lines rather than a step of its line. */
export function isLaneEntry(entry: BuildOrderEntry): boolean {
  if (entry.kind === 'housing') return true;
  return (entry.kind === 'towerCoverage' || entry.kind === 'storeCoverage') && entry.lane === true;
}

export type { BuildLineId, StepKey };

export interface BuildLine {
  readonly id: BuildLineId;
  readonly steps: readonly BuildOrderEntry[];
}

/** A seat's build order: its lines, and the priority in which a free construction site goes to their
 *  ready steps, first id first; a line the priority leaves out comes after, in declaration order. */
export interface BuildOrder {
  readonly lines: readonly BuildLine[];
  readonly priority: readonly BuildLineId[];
}

export function stepKey(line: BuildLineId, step: number): StepKey {
  return `${line}:${step}`;
}

const sortedLines = new WeakMap<BuildOrder, readonly BuildLine[]>();

/** `order`'s lines in its priority order. */
export function linesByPriority(order: BuildOrder): readonly BuildLine[] {
  const known = sortedLines.get(order);
  if (known !== undefined) return known;
  const rank = (line: BuildLine): number => {
    const at = order.priority.indexOf(line.id);
    return at < 0 ? order.priority.length : at;
  };
  const sorted = [...order.lines].sort((a, b) => rank(a) - rank(b));
  sortedLines.set(order, sorted);
  return sorted;
}

const flatSteps = new WeakMap<BuildOrder, readonly BuildOrderEntry[]>();

/** Every step of `order`, line after line, for the readers that only ask what the order holds. */
export function orderSteps(order: BuildOrder): readonly BuildOrderEntry[] {
  const known = flatSteps.get(order);
  if (known !== undefined) return known;
  const steps = order.lines.flatMap((line) => line.steps);
  flatSteps.set(order, steps);
  return steps;
}

/** `skip` (not expressible in this content set, nothing left to collect, enough of it stored, or a
 *  discovery the seat can never make) counts as done for sequencing. */
export type EntryStatus = 'skip' | 'satisfied' | 'unmet';

/** Each line's step statuses, in step order, by line id. `heldCollectors` names the unmet collector steps
 *  their `holdUntil` holds this decision, which `lineStatuses` works out for the workforce's
 *  `collectorGoodsWanted`. */
export interface LineStatuses extends ReadonlyMap<BuildLineId, readonly EntryStatus[]> {
  readonly heldCollectors?: ReadonlySet<BuildOrderEntry>;
}
