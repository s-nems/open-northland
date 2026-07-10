import { Container, Graphics } from 'pixi.js';
import type { ElevationField } from '../data/elevation.js';
import { ONE, tileToScreen } from '../data/iso.js';

/**
 * The DOOR-BADGE layer — a small stacked marker beside each staffed building's door showing how many
 * settlers work there (one badge per worker), drawn in WORLD space (a child of the camera's
 * `worldLayer`, ABOVE the sprite layer so it floats over the house) so it pans/zooms with the building.
 * Like the selection rings this is a CLIENT-side projection of the frozen snapshot, not sim state — the
 * app tallies each building's bound workers (the {@link DoorBadge} list) and this layer projects them.
 *
 * RETAINED, like the selection layer: one badge-stack {@link Container} per building id (a stable key),
 * rebuilt only when its worker/carrier counts change, otherwise just repositioned each frame; a stack
 * whose building left the badge list is destroyed. The stack anchors on the building's DOOR node
 * (projected via {@link tileToScreen} + the terrain lift, the same math the selection ring uses), and
 * grows UPWARD from it — one square per person.
 *
 * The badge art is a PLACEHOLDER (coloured squares — {@link WORKER_COLOR} vs {@link CARRIER_COLOR} so a
 * carrier reads differently from any other worker), a deliberate stand-in until the original round
 * order-plate glyphs are wired; the layout, stacking, and carrier/worker split are the real behaviour.
 */

/** One building's badge data: its door-node position (snapshot `Position` fixed-point units, projected
 *  here) and the counts of settlers bound to it, split so a carrier draws differently. */
export interface DoorBadge {
  /** The building entity id — the retained-pool key (ids are monotonic, a stable key). */
  readonly id: number;
  /** Door-node position in fixed-point `Position` units (same space as a snapshot `Position`). */
  readonly x: number;
  readonly y: number;
  /** Non-carrier workers bound to this building. */
  readonly workers: number;
  /** Carriers (haulers) bound to this building — drawn in {@link CARRIER_COLOR}. */
  readonly carriers: number;
}

/** Placeholder square edge + vertical gap between stacked badges (world px). */
const SIZE = 9;
const GAP = 3;
/** Sit the stack BESIDE the door (not centred on it) and a touch ABOVE the door node. */
const OFFSET_X = 10;
const DOOR_LIFT = 6;
/** Placeholder colours: a worker vs a carrier, with a dark outline so both read on any ground. */
const WORKER_COLOR = 0x5ab6ff;
const CARRIER_COLOR = 0xffbb33;
const BORDER_COLOR = 0x1a1206;

interface BadgeStack {
  readonly node: Container;
  readonly workers: number;
  readonly carriers: number;
}

export class BadgeLayer {
  readonly container = new Container();
  /** One persistent badge-stack per building id; rebuilt only when its counts change, else repositioned. */
  private readonly stacks = new Map<number, BadgeStack>();
  /** Reused per-frame scratch of ids drawn this frame (avoids a per-frame allocation). */
  private readonly drawn = new Set<number>();

  /**
   * Reconcile the badge stacks to `badges`: get-or-(re)build a stack per building whose counts changed,
   * move it to the building's door node (projected + terrain-lifted), then destroy stacks for buildings
   * no longer in the list. An empty list retires every stack.
   */
  draw(badges: readonly DoorBadge[], elevation?: ElevationField): void {
    this.drawn.clear();
    for (const badge of badges) {
      if (badge.workers + badge.carriers <= 0) continue;
      const tileX = badge.x / ONE;
      const tileY = badge.y / ONE;
      const p = tileToScreen(tileX, tileY);
      const lift = elevation !== undefined && elevation.maxLift > 0 ? elevation.liftAt(tileX, tileY) : 0;

      let stack = this.stacks.get(badge.id);
      if (stack === undefined || stack.workers !== badge.workers || stack.carriers !== badge.carriers) {
        stack?.node.destroy({ children: true });
        const node = makeStack(badge.workers, badge.carriers);
        this.container.addChild(node);
        stack = { node, workers: badge.workers, carriers: badge.carriers };
        this.stacks.set(badge.id, stack);
      }
      stack.node.position.set(p.x + OFFSET_X, p.y - lift - DOOR_LIFT);
      this.drawn.add(badge.id);
    }
    // Retire stacks not drawn this frame (building demolished, unstaffed, or left the snapshot).
    if (this.stacks.size > this.drawn.size) {
      for (const [id, stack] of this.stacks) {
        if (this.drawn.has(id)) continue;
        stack.node.destroy({ children: true });
        this.stacks.delete(id);
      }
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.stacks.clear();
  }
}

/** A door badge stack: `carriers` squares at the bottom then `workers` above, one per person, growing
 *  UP from the door anchor (row 0 is the lowest square, just above the door). */
function makeStack(workers: number, carriers: number): Container {
  const c = new Container();
  const total = carriers + workers;
  for (let i = 0; i < total; i++) {
    const color = i < carriers ? CARRIER_COLOR : WORKER_COLOR;
    const yTop = -(i + 1) * (SIZE + GAP);
    const g = new Graphics();
    g.rect(0, yTop, SIZE, SIZE).fill({ color }).stroke({ width: 1, color: BORDER_COLOR, alpha: 0.9 });
    c.addChild(g);
  }
  return c;
}
