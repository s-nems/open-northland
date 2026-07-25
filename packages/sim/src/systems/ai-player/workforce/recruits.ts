import { Building, JobAssignment } from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { isCarrierJob } from '../../stores/index.js';
import { type BuildOrderEntry, barracksEntryIndex, type EntryStatus } from '../build-order/index.js';
import { BARRACKS_BUILDING_ID, isBuilt, ownedBuildings } from '../shared.js';
import type { SpareForce } from './pool.js';

// RECRUITS — the army investment while barracks training is unimplemented (user decision
// 2026-07-25): surplus men are posted into the barracks' transport (carrier) slots, so they stand
// at the barracks as CIVILIANS — no soldier setJob, because the sim resolves a weapon from the
// (tribe, job) binding for free and that would cheat the economy.
// TODO(barracks-training): when barracks recruitment/training lands
// (docs/tickets/features/barracks-recruitment.md, barracks-training.md), these carrier-slot
// recruits are the men to train and equip there.

/** The surplus share sent to the barracks the moment one stands (percent). */
export const RECRUIT_PERCENT_AT_BARRACKS = 50;
/** The surplus share once every build-order entry after the barracks is satisfied (percent). */
export const RECRUIT_PERCENT_FULL = 100;
const PERCENT_DENOMINATOR = 100;

/**
 * The surplus share (percent) the seat invests in recruits — the army ramp: {@link
 * RECRUIT_PERCENT_AT_BARRACKS} at the barracks entry, growing linearly with the satisfied share of
 * the entries after it to {@link RECRUIT_PERCENT_FULL} at list completion (`skip` counts as
 * satisfied — an inexpressible entry must not stall the ramp). An order with no barracks entry
 * ramps straight to full — a map-granted barracks is the only gate then (`allocateRecruits`).
 * Statuses regress with the world (a razed home), so the share can temporarily drop — the release
 * path handles it.
 */
export function recruitPercent(order: readonly BuildOrderEntry[], statuses: readonly EntryStatus[]): number {
  const barracksAt = barracksEntryIndex(order);
  if (barracksAt < 0) return RECRUIT_PERCENT_FULL;
  const after = statuses.slice(barracksAt + 1);
  if (after.length === 0) return RECRUIT_PERCENT_FULL;
  const satisfied = after.filter((s) => s !== 'unmet').length;
  return (
    RECRUIT_PERCENT_AT_BARRACKS +
    Math.floor(((RECRUIT_PERCENT_FULL - RECRUIT_PERCENT_AT_BARRACKS) * satisfied) / after.length)
  );
}

/** The lowest transport (carrier) trade in content, or null when the content has none. */
function carrierJobOf(ctx: SystemContext): number | null {
  let best: number | null = null;
  for (const job of ctx.content.jobs) {
    if (!isCarrierJob(ctx, job.typeId)) continue;
    if (best === null || job.typeId < best) best = job.typeId;
  }
  return best;
}

/**
 * Recruit keeping: `min(carrier capacity, ramp share of the surplus)` recruits stay posted at the
 * seat's built barracks. The surplus is the men this phase may govern — current recruits plus the
 * still unclaimed pool — so the ramp-down releases as naturally as the ramp-up hires; releases walk
 * the classification order backwards (highest entity id first — a deterministic pick, not a tenure
 * rule) and rejoin the pool as builders. Capacity is the barracks' own carrier slots (4 per
 * barracks in the base data) — the ceiling until real training adds a sink. The JobSystem may fill
 * a barracks slot on its own (a loose carrier reports in); such a man is indistinguishable from a
 * recruit and simply counts toward `desired`.
 */
export function allocateRecruits(
  world: World,
  ctx: SystemContext,
  player: number,
  order: readonly BuildOrderEntry[],
  statuses: readonly EntryStatus[],
  recruits: readonly Entity[],
  force: SpareForce,
  builderJob: number | null,
): Command[] {
  const index = contentIndex(ctx.content);
  const carrierJob = carrierJobOf(ctx);
  if (carrierJob === null) return [];
  const posts: Array<{ building: Entity; capacity: number }> = [];
  for (const e of ownedBuildings(world, player)) {
    if (!isBuilt(world, e)) continue;
    const type = index.buildings.get(world.get(e, Building).buildingType);
    if (type === undefined || type.id !== BARRACKS_BUILDING_ID) continue;
    let capacity = 0;
    for (const slot of type.workers) {
      if (isCarrierJob(ctx, slot.jobType)) capacity += slot.count;
    }
    posts.push({ building: e, capacity });
  }
  const capacity = posts.reduce((sum, p) => sum + p.capacity, 0);
  const percent = posts.length === 0 ? 0 : recruitPercent(order, statuses);
  const surplus = recruits.length + force.remaining().length;
  const desired = Math.min(capacity, Math.floor((surplus * percent) / PERCENT_DENOMINATOR));

  const commands: Command[] = [];
  if (recruits.length > desired) {
    // Ramp-down (or a lost barracks): release the newest posts back to the builder pool.
    for (let i = recruits.length - 1; i >= desired; i--) {
      const recruit = recruits[i];
      if (recruit !== undefined && builderJob !== null) {
        commands.push({ kind: 'setJob', entity: recruit, jobType: builderJob });
      }
    }
    return commands;
  }
  // Ramp-up: fill barracks in canonical order, respecting each one's remaining slots.
  const held = new Map<Entity, number>();
  for (const r of recruits) {
    const workplace = world.tryGet(r, JobAssignment)?.workplace;
    if (workplace !== undefined) held.set(workplace, (held.get(workplace) ?? 0) + 1);
  }
  let need = desired - recruits.length;
  for (const post of posts) {
    let free = post.capacity - (held.get(post.building) ?? 0);
    while (free > 0 && need > 0) {
      const spare = force.take();
      if (spare === null) return commands;
      commands.push({
        kind: 'assignWorker',
        entity: spare,
        building: post.building,
        jobPriority: [carrierJob],
      });
      free--;
      need--;
    }
  }
  return commands;
}
