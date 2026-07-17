import type { ContentSet } from '@open-northland/data';
import { Building, Position, Resource, ResourceFootprint, Signpost } from '../../../components/index.js';
import type { World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import { ANCHOR_ONLY, buildingFlagBody, buildingFootprintOf } from '../geometry.js';

// The single definition of what a standing entity blocks, as (cell, channel) pairs. Every placement rule
// in this folder — building (./building.ts) and work flag (./work-flag.ts), each in both its sparse and
// dense form — is stamped from this ONE store walk and differs only in which channels it consumes, so a
// new blocker kind added here reaches every rule and no two rules can drift apart.

/**
 * What a standing entity contributes to a cell — merged across entity KIND within each channel, because
 * every rule treats resource and building the same within one:
 *  - **OBSTACLE** — resource WALK bodies, existing building FAMILY bodies, signpost cells. Rejects a
 *    building candidate's RESERVED zone (the "minimum distance from a node/wall") and any work flag. A
 *    building's door is part of its family body, so it stays walkable for routing but takes no flag.
 *  - **EXCLUSION** — resource BUILD zones + existing building RESERVED zones. Rejects a building
 *    candidate's FAMILY BODY; a margin zone is still valid open ground for a work flag.
 *  - **RESOURCE_ANCHOR** — a footprinted resource's own cell, which its walk body need not cover. Blocks a
 *    work flag only; a footprint-less resource contributes OBSTACLE instead (the pre-footprint same-tile
 *    rule), which already covers its anchor for both rules.
 * Delivery-flag markers are NOT a channel here: they are the one blocker that moves, so the work-flag
 * rule layers them fresh per query (work-flag.ts) over this scan's memoized result.
 */
const OBSTACLE = 0;
const EXCLUSION = 1;
const RESOURCE_ANCHOR = 2;
type BlockerChannel = typeof OBSTACLE | typeof EXCLUSION | typeof RESOURCE_ANCHOR;

export { type BlockerChannel, EXCLUSION, OBSTACLE, RESOURCE_ANCHOR };

/**
 * Enumerate every (cell, channel) the world's standing resources, buildings and signposts contribute.
 * Consumers filter by channel; a cell may be visited on more than one channel, and every consumer takes
 * set unions / mask writes (membership, no pick), so store-iteration order cannot change any later answer.
 */
export function eachBlockerCell(
  world: World,
  content: ContentSet,
  visit: (x: number, y: number, channel: BlockerChannel) => void,
): void {
  for (const e of world.query(Resource, Position)) {
    const p = world.get(e, Position);
    const { hx, hy } = nodeOfPosition(p.x, p.y);
    const fp = world.tryGet(e, ResourceFootprint);
    if (fp === undefined) {
      visit(hx, hy, OBSTACLE); // legacy anchor-only resource keeps the old same-tile rule
      continue;
    }
    visit(hx, hy, RESOURCE_ANCHOR);
    for (const c of fp.walk) visit(hx + c.dx, hy + c.dy, OBSTACLE);
    for (const c of fp.build) visit(hx + c.dx, hy + c.dy, EXCLUSION);
  }
  for (const e of world.query(Building, Position)) {
    const b = world.get(e, Building);
    const p = world.get(e, Position);
    const { hx, hy } = nodeOfPosition(p.x, p.y);
    const fp = buildingFootprintOf(content, b.buildingType);
    const body = buildingFlagBody(content, b.buildingType);
    const zone = fp?.reserved.length ? fp.reserved : ANCHOR_ONLY;
    for (const c of body) visit(hx + c.dx, hy + c.dy, OBSTACLE);
    for (const c of zone) visit(hx + c.dx, hy + c.dy, EXCLUSION);
  }
  // A signpost blocks building placement on its cell (never movement — it enters no walk overlay): its
  // anchor is an OBSTACLE, so no building's reserved zone may cover it (observed original behaviour).
  for (const e of world.query(Signpost, Position)) {
    const p = world.get(e, Position);
    const { hx, hy } = nodeOfPosition(p.x, p.y);
    visit(hx, hy, OBSTACLE);
  }
}

/**
 * A per-world version of the placement-blocker INPUTS — the component stores {@link eachBlockerCell} reads:
 * whether each `Building`, `Resource`, `ResourceFootprint` and `Signpost` exists. Their generations bump only on add/remove ({@link World.componentGeneration}), so this
 * moves precisely when those cells can change — NOT every tick — and the building overlay reuses its last
 * result until it does. The work-flag rule adds the `DeliveryFlag` generation on top
 * ({@link workFlagBlockerVersion}). Exactness rests on three standing invariants (all hold today):
 *   - buildings and resources never MOVE once placed (only settlers/vehicles/projectiles mutate Position),
 *     so a stored entity's cells are fixed;
 *   - `familyBody`/`reserved` are the union across a type's whole level chain (the extractor stamps the
 *     same arrays on every level's typeId — schema.ts), so an in-place level-up leaves the set unchanged;
 *   - a `ResourceFootprint` stamp/unstamp is always bundled in the same step with the `Resource` add/destroy
 *     that also moves this version — folding its generation in is belt-and-suspenders for any future path
 *     that decouples them (a miss would leave a stale overlay wash for a frame, never a placement decision:
 *     the command gate always re-scans fresh).
 * A string (not a packed number) so the monotonic counters compose with no overflow/aliasing reasoning.
 * Read-only + deterministic (a pure function of the mutation history); never hashed, never a sim decision.
 */
export function placementBlockerVersion(world: World): string {
  return `${world.componentGeneration(Building)}.${world.componentGeneration(Resource)}.${world.componentGeneration(ResourceFootprint)}.${world.componentGeneration(Signpost)}`;
}
