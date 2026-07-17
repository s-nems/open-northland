import { ErectSignpostOrder, PlayerOrder, Settler } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';
import type { HalfCellNode } from '../../nav/halfcell.js';
import { withinNodeRadius } from '../../nav/node-metric.js';
import type { SystemContext } from '../context.js';
import { SCOUT_JOB } from '../readviews/stances.js';
import { signpostNetwork, signpostProbe } from '../signposts/index.js';
import type { AiPlayerModule } from './index.js';
import { anchorNodeOf, firstRingNode, headquartersOf, ownedSettlers } from './shared.js';

/**
 * The GuideBuild module — the scout rings the settlement with signposts (user plan, 2026-07-17):
 * one post beside the headquarters, then one per {@link SIGNPOST_RING_OFFSETS} spot on a wide
 * circle around it, so the posts' nav circles tile one large covered disc. One order per decision;
 * the workforce module calls a scout up from the builder pool exactly while {@link
 * nextSignpostTarget} has work, and turns an idle scout back into a builder when it doesn't.
 */

/** The ring's world-metric radius in nodes — with the 40-node nav circles, ring posts overlap the
 *  centre post and each other, covering a disc ~{@link SIGNPOST_RING_RADIUS_NODES}+40 wide. A
 *  named approximation (the original's HAI guide placement is undecoded); tuned for one HQ ring. */
export const SIGNPOST_RING_RADIUS_NODES = 60;

/**
 * The centre + eight ring targets as node offsets from the HQ anchor. The lattice is anisotropic
 * (a node step is 34 px E/W but 19 px N/S — `nav/node-metric.ts`), so a world-metric circle of
 * radius 60 spans ±60 nodes in x but ±60·34/19 ≈ ±107 rows in y; the diagonals are 60/√2 ≈ 42
 * scaled the same way (42·34/19 ≈ 75). Integer literals, precomputed — the sim allows no trig.
 */
export const SIGNPOST_RING_OFFSETS: readonly { dx: number; dy: number }[] = [
  { dx: 0, dy: 0 },
  { dx: 60, dy: 0 },
  { dx: 42, dy: 75 },
  { dx: 0, dy: 107 },
  { dx: -42, dy: 75 },
  { dx: -60, dy: 0 },
  { dx: -42, dy: -75 },
  { dx: 0, dy: -107 },
  { dx: 42, dy: -75 },
];

/** How far a post may stand from its ring target and still satisfy it — also the legal-spot search
 *  reach, so an erected post always satisfies the target it was placed for. */
export const SIGNPOST_TARGET_TOLERANCE_NODES = 16;

/**
 * The next erectable ring target for the seat: the first {@link SIGNPOST_RING_OFFSETS} spot (in
 * ring order) with no own post within the tolerance AND a legal node to erect on. Null when the
 * ring stands complete or every remaining target is unbuildable (off-map, water, blocked) — the
 * workforce module reads that as "no scout work" and returns the scout to the builder pool.
 */
export function nextSignpostTarget(world: World, ctx: SystemContext, player: number): HalfCellNode | null {
  const terrain = ctx.terrain;
  if (terrain === undefined) return null;
  const hq = headquartersOf(world, ctx, player);
  if (hq === null) return null;
  const anchor = anchorNodeOf(world, hq);
  if (anchor === null) return null;
  const posts = signpostNetwork(world).get(player) ?? [];
  let probe: ReturnType<typeof signpostProbe> | null = null;
  for (const offset of SIGNPOST_RING_OFFSETS) {
    const tx = anchor.hx + offset.dx;
    const ty = anchor.hy + offset.dy;
    const satisfied = posts.some((s) =>
      withinNodeRadius(s.hx, s.hy, tx, ty, SIGNPOST_TARGET_TOLERANCE_NODES),
    );
    if (satisfied) continue;
    if (probe === null) probe = signpostProbe(world, ctx.content, terrain, player);
    const p = probe;
    const spot = firstRingNode(tx, ty, SIGNPOST_TARGET_TOLERANCE_NODES, (x, y) => p.canPlace(x, y));
    if (spot !== null) return spot;
  }
  return null;
}

function runSignpostCoverage(world: World, ctx: SystemContext, player: number): readonly Command[] {
  const scout = ownedSettlers(world, player).find((e) => world.get(e, Settler).jobType === SCOUT_JOB);
  if (scout === undefined) return [];
  if (world.has(scout, ErectSignpostOrder) || world.has(scout, PlayerOrder)) return []; // busy
  const target = nextSignpostTarget(world, ctx, player);
  if (target === null) return []; // ring complete — the workforce module retires the scout
  return [{ kind: 'placeSignpost', entity: scout, x: target.hx, y: target.hy }];
}

export const signpostCoverageModule: AiPlayerModule = {
  id: 'guideBuild',
  run: runSignpostCoverage,
};
