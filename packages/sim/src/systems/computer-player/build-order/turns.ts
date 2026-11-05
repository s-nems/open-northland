import { BUILDING_KIND, type BuildingType } from '@open-northland/data';
import { Building, UnderConstruction, Upgrading } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { buildingTypeByContentId, countedTiers } from '../../ai-shared/content-lookup.js';
import type { SystemContext } from '../../context.js';
import { buildingEnabled } from '../../progression/index.js';
import type { TechnologyTable } from '../technology/requirements.js';
import {
  type BuildLine,
  type BuildLineId,
  type BuildOrder,
  type BuildOrderEntry,
  type EntryStatus,
  isLaneEntry,
  type StepHold,
} from './order/entries.js';
import { DEFENCE_LINES } from './order/seat-order.js';
import { foodChainStep, seatFoodFailing } from './steps/food-first.js';
import type { DecisionMemo } from './steps/memo.js';
import { entryStatus, upgradeCandidate, upgradeFilter } from './steps/status.js';
import { upgradeReach } from './supply/upgrade-reach.js';

/** A line's turn, the lower first: a defence line ({@link DEFENCE_LINES}) with no rising site of its own
 *  while the seat's defence comes first; a next placement waiting on the military deadline
 *  ({@link deadlineStep}), even beside a rising site of its own, and it takes the earned workshops' extra
 *  site too (owner ruling: the barracks stands a bit before the deadline; on krwawa_rzeka and magiczny_las
 *  under a 60-minute peace, with every site of the pace taken, it waited behind the economy's new kinds and
 *  earned workshops until minute 60-90); no rising site and a next step raising a workshop the seat lacks
 *  whose discovery it earned ({@link earnedWorkshop}); no rising site and a next step raising a kind it
 *  lacks or a copy placed ahead of the crews (owner ruling: a tunic seat's second tailor shop lost every
 *  freed site to new kinds until game minute 37-83 on krwawa_rzeka); no rising site; a site of its own
 *  still rising. On mroczny_las a seat defending from the first
 *  minute gave every freed site to its earned workshops and raised no barracks before the scripted wave.
 *  On a seat whose food production is missing ({@link seatFoodFailing}), a step ready to raise the first
 *  of a food chain kind comes right after the due steps, a rising site of its line or not, ahead of the
 *  lanes too, and takes the extra site only as an earned workshop (owner ruling: food before the
 *  population, weapons and joiner). A `core` step takes the earned turn and its extra site while no food
 *  turn waits: as a new kind the school never won a freed site from the earned workshops, and ahead of the
 *  food it beat the mill and bakery. A `firstRank` step keeps the turn of a first new kind, the earned one
 *  once discovered, beside a rising site of its line and as another of a kind the seat owns (owner
 *  ruling: the first brewery, its hive and well rank with the bakery; on magiczny_las the hive, unlocked
 *  with the brewery, waited out the brewery's eight to ten minute site in the rising turn, and the brewery
 *  brews nothing without honey). */
export const TURN = { defence: 0, due: 1, food: 2, earned: 3, newKind: 4, more: 5, rising: 6 } as const;

/** Whether `entry` goes up at its building's unlock ({@link BuildOrderEntry} `atUnlock`). */
export function atUnlockStep(entry: BuildOrderEntry): entry is Extract<BuildOrderEntry, { kind: 'place' }> {
  return entry.kind === 'place' && entry.atUnlock === true;
}

/** Whether some `atUnlock` step of `order` raises a kind the seat owns none of, the cheap test before
 *  the decision reads the lines' statuses for {@link atUnlockStep} placements. */
export function atUnlockPending(
  world: World,
  ctx: SystemContext,
  order: BuildOrder,
  owned: readonly Entity[],
): boolean {
  let ownedTypes: Set<number> | undefined;
  for (const line of order.lines) {
    for (const entry of line.steps) {
      if (!atUnlockStep(entry)) continue;
      const type = buildingTypeByContentId(ctx.content, entry.building);
      if (type === undefined) continue;
      ownedTypes ??= new Set(owned.map((e) => world.get(e, Building).buildingType));
      const tiers = countedTiers(ctx.content, type, entry.belowTier);
      if (![...tiers].some((kind) => ownedTypes?.has(kind) === true)) return true;
    }
  }
  return false;
}

/** Whether `entry` ranks with the bread chain's first buildings ({@link BuildOrderEntry} `firstRank`). */
export function firstRankStep(entry: BuildOrderEntry): boolean {
  return (entry.kind === 'place' || entry.kind === 'upgrade') && entry.firstRank === true;
}

/** Whether `entry` is a placement its line holds until the military deadline's lead: once the hold opens
 *  it takes the next free site; while it holds, its line acts on nothing, so the turn costs no site. */
export function deadlineStep(entry: BuildOrderEntry): boolean {
  return entry.kind === 'place' && entry.holdUntil !== undefined && waitsOnDeadline(entry.holdUntil);
}

export function waitsOnDeadline(hold: StepHold): boolean {
  if (hold.kind === 'all' || hold.kind === 'any') return hold.holds.some(waitsOnDeadline);
  return hold.kind === 'deadline';
}

/** What the food rule asks of {@link turnOrder}: whether the seat's food fails ({@link seatFoodFailing}),
 *  and whether a step is ready for a site rather than held or waiting on a discovery. */
export interface FoodTurn {
  readonly foodFailing: boolean;
  readonly ready: (entry: BuildOrderEntry) => boolean;
}

/** A line's {@link TURN}, and whether it may take the earned workshops' site over the pace. */
export interface LineTurn {
  readonly line: BuildLine;
  readonly turn: number;
  readonly extraSite: boolean;
}

/** `lines`, stable in priority order, by {@link TURN}, each with its turn. `gated` holds the seat's
 *  technology table while its progression gates apply; `defending` whether its defence comes first; a
 *  `passed` step never heads its line. */
export function turnOrder(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  lines: readonly BuildLine[],
  statusOf: (line: BuildLineId, step: number) => EntryStatus | undefined,
  memo: DecisionMemo,
  gated: TechnologyTable | null,
  defending: boolean,
  passed: (entry: BuildOrderEntry) => boolean,
  food: FoodTurn,
): LineTurn[] {
  const standing = owned.filter((e) => !world.has(e, UnderConstruction) || world.has(e, Upgrading));
  const ownedTypes = new Set(owned.map((e) => world.get(e, Building).buildingType));
  /** Whether the seat owns a building `entry` counts, so the step adds another of a kind it has. */
  const ownsKind = (entry: BuildOrderEntry, type: BuildingType): boolean => {
    // An unmet role step has no building of its tiers holding the role, so it raises a kind the seat lacks.
    if (entry.kind === 'place' && entry.role !== undefined) return false;
    const below = entry.kind === 'place' || entry.kind === 'upgrade' ? entry.belowTier : undefined;
    for (const kind of countedTiers(ctx.content, type, below)) if (ownedTypes.has(kind)) return true;
    return false;
  };
  const heads = lines.map((line) => {
    let next: BuildOrderEntry | undefined;
    let rising = false;
    for (const [step, entry] of line.steps.entries()) {
      if (isLaneEntry(entry)) continue;
      const status = statusOf(line.id, step);
      if (
        !rising &&
        status === 'satisfied' &&
        entryStatus(world, ctx, player, standing, entry, memo, false) === 'unmet'
      )
        rising = true;
      if (status === 'unmet' && !passed(entry)) next ??= entry;
      if (rising && next !== undefined) break;
    }
    const type =
      next === undefined || next.kind === 'collector'
        ? undefined
        : buildingTypeByContentId(ctx.content, next.building);
    // The food turn raises the first of a food chain kind; copies wait their turn like any other.
    const feeds =
      food.foodFailing &&
      next !== undefined &&
      type !== undefined &&
      foodChainStep(ctx, next) &&
      !ownsKind(next, type) &&
      food.ready(next);
    return { line, next, type, rising, feeds };
  });
  const foodWaits = heads.some((head) => head.feeds);
  const rank = (head: (typeof heads)[number]): Omit<LineTurn, 'line'> => {
    const { line, next, type, rising, feeds } = head;
    const plain = (turn: number): Omit<LineTurn, 'line'> => ({
      turn,
      extraSite: turn === TURN.due || turn === TURN.earned,
    });
    if (defending && !rising && next !== undefined && DEFENCE_LINES.includes(line.id))
      return plain(TURN.defence);
    // A later step met by a rising site, such as a tower upgrade met by a ring tower raised at the upper
    // tier, never puts a deadline step behind the economy.
    if (next !== undefined && deadlineStep(next)) return plain(TURN.due);
    const earned = type !== undefined && earnedWorkshop(gated, type);
    if (feeds) return { turn: TURN.food, extraSite: earned };
    const ranked = next !== undefined && firstRankStep(next);
    if (rising && !ranked) return plain(TURN.rising);
    if (next === undefined || next.kind === 'collector' || type === undefined) return plain(TURN.newKind);
    if (!ranked && ownsKind(next, type))
      return plain(next.kind === 'place' && next.aheadOfCrews === true ? TURN.newKind : TURN.more);
    if (earned || (next.kind === 'place' && next.core === true && !foodWaits)) return plain(TURN.earned);
    return plain(TURN.newKind);
  };
  return heads.map((head) => ({ line: head.line, ...rank(head) })).sort((a, b) => a.turn - b.turn);
}

/**
 * Whether `type` is a workshop a discovery opens for the seat (its `gated` technology row asks for a job
 * or a good). Owner ruling: once a trade is discovered its building goes up promptly, the apprentice who
 * earned it waiting to move in; on magiczny_las and diamentowa_dolina the opening's home upgrades and the
 * tower ring took the two opening sites for five to twenty game minutes after the mill, animal farm and
 * smithy were discovered. A locked step still holds its line, so the turn only matters once it opens.
 */
export function earnedWorkshop(gated: TechnologyTable | null, type: BuildingType): boolean {
  if (gated === null || type.kind !== BUILDING_KIND.workplace) return false;
  const row = gated.houses.get(type.typeId);
  return row !== undefined && row.jobs.length + row.goods.length > 0;
}

/** Whether `entry` is passed over rather than holding its line while its building's tier is locked. */
export function lockPasses(entry: BuildOrderEntry): boolean {
  return (entry.kind === 'place' || entry.kind === 'upgrade') && entry.lockPasses === true;
}

/** Whether `entry`'s building is one the seat cannot raise yet: a placed tier not enabled for the seat's
 *  placement tribe, or an upgrade whose candidate's next tier is not, so an upgrade still rises as far as
 *  the seat may ({@link upgradeReach}). A seat with no placement tribe holds rather than passes. */
export function stepLocked(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  tribe: number | undefined,
  entry: BuildOrderEntry,
  memo: DecisionMemo,
): boolean {
  if (tribe === undefined || entry.kind === 'collector') return false;
  const type = buildingTypeByContentId(ctx.content, entry.building);
  if (type === undefined) return false;
  if (entry.kind !== 'upgrade') return !buildingEnabled(world, ctx, player, tribe, type.typeId);
  const index = contentIndex(ctx.content);
  const candidate = upgradeCandidate(
    world,
    index,
    owned,
    type,
    upgradeFilter(world, ctx, player, entry, memo),
  );
  if (candidate === null) return false;
  const building = world.get(candidate, Building);
  const next = index.buildings.get(building.buildingType)?.upgradeTarget;
  return next !== undefined && !buildingEnabled(world, ctx, player, building.tribe, next);
}
