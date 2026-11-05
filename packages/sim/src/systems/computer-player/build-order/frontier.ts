import { aiControlEntity, BuildOrderFrontier } from '../../../components/index.js';
import type { World } from '../../../ecs/world.js';
import type { BuildLineId, BuildOrderEntry } from './entries.js';
import { REBUILD_DELAY_TICKS } from './limits.js';

/**
 * Whether the acting step is a razed building's, fallen back below its line's frontier, still inside
 * {@link REBUILD_DELAY_TICKS} of the decision that first saw it or, later, of the last one that saw the
 * seat `attacked`. Only a counted building step regresses this way; a coverage step re-arms by design
 * and a collector is hired, not built, so neither moves the frontier. A passed-over placement that
 * finds room again falls below the frontier the same way and waits the delay once. A seat with no AI
 * carrier (a module run directly) keeps no frontier and never waits.
 */
export function awaitingRebuild(
  world: World,
  player: number,
  line: BuildLineId,
  step: number,
  entry: BuildOrderEntry,
  tick: number,
): boolean {
  const carrier = aiControlEntity(world, player);
  if (carrier === null) return false;
  const frontier = world.tryGet(carrier, BuildOrderFrontier)?.lines.get(line);
  if (frontier === undefined || step >= frontier.step) {
    advanceFrontier(world, player, line, step);
    return false;
  }
  if (entry.kind !== 'place' && entry.kind !== 'upgrade') return false;
  const held = frontier.rebuildTick;
  if (held === null) {
    world
      .mut(carrier, BuildOrderFrontier)
      .lines.set(line, { step: frontier.step, rebuildTick: tick + REBUILD_DELAY_TICKS });
    return true;
  }
  return tick < held;
}

/** Under siege the lines act on nothing and search nothing, so a lost step below its line's frontier only
 *  has its rebuild wait pushed out to run from the siege's end; the frontier stays where it is. */
export function holdRebuildUnderAttack(
  world: World,
  player: number,
  line: BuildLineId,
  step: number,
  entry: BuildOrderEntry,
  tick: number,
): void {
  const carrier = aiControlEntity(world, player);
  if (carrier === null) return;
  const frontier = world.tryGet(carrier, BuildOrderFrontier)?.lines.get(line);
  if (frontier === undefined || step >= frontier.step) return;
  if (entry.kind !== 'place' && entry.kind !== 'upgrade') return;
  const held = frontier.rebuildTick;
  if (held === null || held < tick + REBUILD_DELAY_TICKS)
    world
      .mut(carrier, BuildOrderFrontier)
      .lines.set(line, { step: frontier.step, rebuildTick: tick + REBUILD_DELAY_TICKS });
}

/** Raise `line`'s frontier to `step`, its first unmet step at or past it (the line's length once all are
 *  met), and end any rebuild wait, since nothing below the frontier is unmet any more. Only this raises
 *  it, so every later loss below it waits out the delay again. */
export function advanceFrontier(world: World, player: number, line: BuildLineId, step: number): void {
  const carrier = aiControlEntity(world, player);
  if (carrier === null) return;
  const record = world.tryGet(carrier, BuildOrderFrontier);
  const current = record?.lines.get(line);
  if (current !== undefined && current.step === step && current.rebuildTick === null) return;
  const frontier = { step, rebuildTick: null };
  if (record === undefined) world.add(carrier, BuildOrderFrontier, { lines: new Map([[line, frontier]]) });
  else world.mut(carrier, BuildOrderFrontier).lines.set(line, frontier);
}
