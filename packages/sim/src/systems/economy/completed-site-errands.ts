import {
  CurrentAtomic,
  MoveGoal,
  removeCurrentAtomic,
  SiteAssignment,
  SupplyRun,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { constructionWorkCells } from '../footprint/index.js';
import { clearNavState, stopAtNextNode } from '../movement/nav-state.js';
import { anotherSystemOwns } from '../settlers/action-owner.js';
import { EntityReferences } from '../spatial/entity-references.js';
import { canonicalById } from '../spatial/nodes.js';

type Assignment = NonNullable<(typeof SiteAssignment)['__value']>;
type Supply = NonNullable<(typeof SupplyRun)['__value']>;
const indexes = new WeakMap<
  World,
  { assignments: EntityReferences<Assignment>; supplies: EntityReferences<Supply> }
>();

/** Call before changing the site's footprint: its old perimeter identifies the approach being retired. */
export function retireCompletedSiteErrands(world: World, ctx: SystemContext, site: Entity): void {
  let index = indexes.get(world);
  if (index === undefined) {
    const assignments = new EntityReferences(world, SiteAssignment, (value) => value.site);
    const supplies = new EntityReferences(world, SupplyRun, (value) => value.site);
    index = { assignments, supplies };
    world.registerCacheVerifier('siteAssignments', () => assignments.verify());
    world.registerCacheVerifier('siteSupplyRuns', () => supplies.verify());
    indexes.set(world, index);
  }
  const workers = canonicalById(new Set([...index.assignments.at(site), ...index.supplies.at(site)]));
  if (workers.length === 0) return;
  const terrain = ctx.terrain;
  // A formerly valid approach still belongs to this task after another blocker covers it.
  const perimeter =
    terrain === undefined ? null : new Set(constructionWorkCells(world, ctx, terrain, site, new Set()));
  for (const e of workers) {
    const supply = world.tryGet(e, SupplyRun);
    const supplying = supply?.site === site;
    if (supplying) world.remove(e, SupplyRun);
    if (world.tryGet(e, SiteAssignment)?.site === site) world.remove(e, SiteAssignment);
    // Crew membership survives detours, meals and orders; only its own work may stop their feet.
    if (anotherSystemOwns(world, e)) continue;
    const atomic = world.tryGet(e, CurrentAtomic);
    const ownAtomic =
      (atomic?.effect.kind === 'construct' && atomic.effect.site === site) ||
      (supplying && atomic?.effect.kind === 'pickup' && atomic.effect.from === supply?.source) ||
      (supplying && atomic?.effect.kind === 'pileup' && atomic.effect.store === site);
    if (atomic !== undefined && !ownAtomic) continue;
    if (ownAtomic) removeCurrentAtomic(world, e);
    const goal = world.tryGet(e, MoveGoal)?.cell;
    if (!supplying && (goal === undefined || perimeter?.has(goal) !== true)) continue;
    if (terrain === undefined) clearNavState(world, e);
    else stopAtNextNode(world, terrain, e);
  }
}
