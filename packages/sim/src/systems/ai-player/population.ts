import { Building, ChildOrder, Female, Marriage, Residence } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isAdultSettler, mayMarry } from '../family/eligibility.js';
import { familiesOf, isMinor } from '../family/households.js';
import type { AiPlayerModule } from './index.js';
import { headquartersOf, isBuilt, ownedBuildings, ownedSettlers } from './shared.js';

/**
 * The HomeExpansion module — population planning (user plan, 2026-07-17): every adult woman marries
 * as soon as a partner exists (grown girls included — the census is recomputed each decision), a
 * married woman's family moves into the first home with a free family slot, and mothers breed to the
 * housing stock: daughters while the planned female count (women + growing girls + pending daughter
 * orders) is below the total family slots, sons continuously once it matches — women in Cultures are
 * made to the number of house places.
 */

function runPopulation(world: World, ctx: SystemContext, player: number): readonly Command[] {
  if (headquartersOf(world, ctx, player) === null) return [];
  const commands: Command[] = [];
  const settlers = ownedSettlers(world, player);
  const women = settlers.filter((e) => world.has(e, Female) && isAdultSettler(world, e));

  // 1. Weddings: one marry order per single woman, capped by the single-men count so the command
  // log doesn't fill with orders that would only auto-cancel.
  const singleWomen = women.filter((e) => mayMarry(world, e));
  const singleMen = settlers.filter(
    (e) => !world.has(e, Female) && isAdultSettler(world, e) && mayMarry(world, e),
  );
  for (let i = 0; i < Math.min(singleWomen.length, singleMen.length); i++) {
    const woman = singleWomen[i];
    if (woman !== undefined) commands.push({ kind: 'marry', entity: woman });
  }

  // 2. Housing: a married, unhoused woman's family takes the first free family slot (homes and
  // slots in canonical order; slots claimed this decision are tracked so two families never target
  // the same one).
  const index = contentIndex(ctx.content);
  const homes: Array<{ entity: Entity; free: number }> = [];
  let familySlotsTotal = 0;
  for (const e of ownedBuildings(world, player)) {
    if (!isBuilt(world, e)) continue;
    const type = index.buildings.get(world.get(e, Building).buildingType);
    if (type === undefined || type.kind !== 'home') continue;
    familySlotsTotal += type.homeSize;
    homes.push({ entity: e, free: type.homeSize - familiesOf(world, e).length });
  }
  for (const woman of women) {
    if (world.has(woman, Residence)) continue;
    if (!isMarried(world, woman)) continue;
    const home = homes.find((h) => h.free > 0);
    if (home === undefined) break; // no free slots — wait for the next house
    home.free--;
    commands.push({ kind: 'assignHouse', entity: woman, house: home.entity });
  }

  // 3. Children: every housed mother without a growing child keeps a standing order — a daughter
  // while planned females run below the family slots, a son once the count is met.
  let plannedFemales = 0;
  for (const e of settlers) {
    if (world.has(e, Female)) plannedFemales++; // women, girls, and baby girls alike
    if (world.tryGet(e, ChildOrder)?.child === 'female') plannedFemales++;
  }
  for (const woman of women) {
    if (world.has(woman, ChildOrder) || !world.has(woman, Residence)) continue;
    if (!isMarried(world, woman)) continue;
    const child = world.get(woman, Marriage).child;
    if (child !== null && world.isAlive(child) && isMinor(world, child)) continue; // one at a time
    if (plannedFemales < familySlotsTotal) {
      plannedFemales++;
      commands.push({ kind: 'makeChild', entity: woman, child: 'female' });
    } else {
      commands.push({ kind: 'makeChild', entity: woman, child: 'male' });
    }
  }
  return commands;
}

/** Married to a living spouse (a widow raising a minor is not orderable into a new family plan). */
function isMarried(world: World, e: Entity): boolean {
  const marriage = world.tryGet(e, Marriage);
  return marriage !== undefined && world.isAlive(marriage.spouse);
}

export const populationModule: AiPlayerModule = {
  id: 'homeExpansion',
  run: runPopulation,
};
