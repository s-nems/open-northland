import { GivenName, Person, SETTLER_NAME_MAX_CHARS, Settler } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { codePointLength, hasControlCharacter } from '../../core/untrusted.js';
import type { World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isHeroJob } from '../readviews/index.js';
import { isOrderableSettler } from './guards.js';

/** Set or clear a settler's {@link GivenName} - see the command doc. The authority gate already refused
 *  another seat's settler; a typed producer skips the payload parser, so the text rules are checked here. */
export function renameSettler(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'renameSettler' }>,
): void {
  const e = command.entity;
  if (!isOrderableSettler(world, e) || !world.has(e, Person)) return;
  if (isHeroJob(ctx.content, world.get(e, Settler).jobType)) return;
  const name = command.name.trim();
  if (name.length === 0) {
    world.remove(e, GivenName);
    return;
  }
  if (codePointLength(name) > SETTLER_NAME_MAX_CHARS || hasControlCharacter(name)) return;
  const given = world.tryGet(e, GivenName);
  if (given === undefined) world.add(e, GivenName, { name });
  else if (given.name !== name) world.mut(e, GivenName).name = name;
}
