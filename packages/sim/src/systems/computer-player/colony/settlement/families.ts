import { Building, Female, Marriage, Residence } from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { isBuilt } from '../../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../../context.js';
import { mayMarry } from '../../../family/eligibility.js';
import { familiesOf } from '../../../family/households.js';

/** What population does at home, over a colony's `people` and `buildings`: one marry order per possible
 *  couple, and a family with no home takes the first free slot. */
export function colonyFamilies(
  world: World,
  ctx: SystemContext,
  people: readonly Entity[],
  buildings: readonly Entity[],
): PlayerCommand[] {
  const index = contentIndex(ctx.content);
  const commands: PlayerCommand[] = [];
  const brides = people.filter((e) => world.has(e, Female) && mayMarry(world, ctx.content, e));
  const grooms = people.filter((e) => !world.has(e, Female) && mayMarry(world, ctx.content, e));
  for (const e of brides.slice(0, grooms.length)) commands.push({ kind: 'marry', entity: e });
  const homes = buildings.flatMap((e) => {
    const type = index.buildings.get(world.get(e, Building).buildingType);
    if (!isBuilt(world, e) || type === undefined || type.kind !== 'home') return [];
    return [{ entity: e, free: type.homeSize - familiesOf(world, e).length }];
  });
  for (const wife of people) {
    if (!world.has(wife, Female) || !world.has(wife, Marriage) || world.has(wife, Residence)) continue;
    const home = homes.find((h) => h.free > 0);
    if (home === undefined) break;
    home.free--;
    commands.push({ kind: 'assignHouse', entity: wife, house: home.entity });
  }
  return commands;
}
