import {
  AssistantChildOrder,
  Building,
  ChildOrder,
  Female,
  Marriage,
  Residence,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isAdultSettler, mayMarry } from '../family/eligibility.js';
import { familiesOf } from '../family/households.js';
import { seatBaseOf } from './base.js';
import type { AiPlayerModule } from './index.js';
import { assistantCounterCommand, isBuilt, ownedBuildings, ownedSettlers } from './shared.js';

/**
 * The HomeExpansion module (authored): every adult woman marries as soon as a partner exists, a married
 * woman's family moves into the first home with a free family slot, and births run through the
 * settlement assistant - daughters up to the housing stock, sons continuously past it.
 */

function runPopulation(world: World, ctx: SystemContext, player: number): readonly Command[] {
  if (seatBaseOf(world, ctx, player) === null) return [];
  const commands: Command[] = [];
  const settlers = ownedSettlers(world, player);
  const women = settlers.filter((e) => world.has(e, Female) && isAdultSettler(world, e));

  // One marry order per single woman, capped by the single-men count so the command log does not fill
  // with orders that would only auto-cancel.
  const singleWomen = women.filter((e) => mayMarry(world, ctx.content, e));
  const singleMen = settlers.filter(
    (e) => !world.has(e, Female) && isAdultSettler(world, e) && mayMarry(world, ctx.content, e),
  );
  for (let i = 0; i < Math.min(singleWomen.length, singleMen.length); i++) {
    const woman = singleWomen[i];
    if (woman !== undefined) commands.push({ kind: 'marry', entity: woman });
  }

  // A married, unhoused woman's family takes the first free family slot, in canonical order; slots
  // claimed this decision are tracked so two families never target the same one.
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
    if (!hasLivingSpouse(world, woman)) continue;
    const home = homes.find((h) => h.free > 0);
    if (home === undefined) break; // no free slots - wait for the next house
    home.free--;
    commands.push({ kind: 'assignHouse', entity: woman, house: home.entity });
  }

  // Both breeding counters are absolute re-sets, issued only when the wanted state differs.
  let femaleStock = 0;
  for (const e of settlers) {
    if (world.has(e, Female)) femaleStock++; // women, girls, and baby girls alike
    // A pending non-assistant daughter order still becomes a female; an assistant-booked order is
    // already accounted inside the counter itself.
    if (world.tryGet(e, ChildOrder)?.child === 'female' && !world.has(e, AssistantChildOrder)) femaleStock++;
  }
  const daughters = assistantCounterCommand(
    world,
    player,
    'extraWomen',
    familySlotsTotal - femaleStock,
    false,
  );
  if (daughters !== null) commands.push(daughters);
  const sons = assistantCounterCommand(world, player, 'extraMen', 0, true);
  if (sons !== null) commands.push(sons);
  return commands;
}

/** Married to a living spouse - narrower than the family rule's `isMarried`, which also counts a widow
 *  raising a minor, because a widow is orderable into a new family plan. */
function hasLivingSpouse(world: World, e: Entity): boolean {
  const marriage = world.tryGet(e, Marriage);
  return marriage !== undefined && world.isAlive(marriage.spouse);
}

export const populationModule: AiPlayerModule = {
  id: 'homeExpansion',
  run: runPopulation,
};
