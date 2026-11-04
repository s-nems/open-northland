import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { isServedConstructionSite } from '../../settlers/targets/index.js';
import { BUILDERS_PER_OPEN_SITE } from '../workforce/staffing.js';

/** The builders a colony keeps once nothing is left to raise (authored): a pair for a lost building, and
 *  every other man digs, which is what the colony is for. */
const BUILDERS_AT_REST = 2;

/**
 * The builders the colony's own sites call for, as home sizes its crew: a pair per open site among
 * `buildings`, and a pair for the next one while `planned` holds more to raise, never under
 * {@link BUILDERS_AT_REST}. Each settlement keeps its own crew: home's sites never count here.
 */
export function colonyBuilderWant(
  world: World,
  ctx: SystemContext,
  buildings: readonly Entity[],
  planned: number,
): number {
  let sites = planned > 0 ? 1 : 0;
  for (const e of buildings) if (isServedConstructionSite(world, ctx.content, e)) sites++;
  return Math.max(BUILDERS_AT_REST, BUILDERS_PER_OPEN_SITE * sites);
}

/** `posts` with exactly `want` builder posts: those past it dropped from the tail, those short of it added
 *  at the end, so the first posts keep their order. */
export function withBuilderPosts<P extends string>(posts: readonly P[], builder: P, want: number): P[] {
  let kept = 0;
  const out = posts.filter((post) => post !== builder || kept++ < want);
  while (kept++ < want) out.push(builder);
  return out;
}
