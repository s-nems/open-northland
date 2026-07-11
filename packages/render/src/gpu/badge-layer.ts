import { Container, Graphics } from 'pixi.js';
import type { ElevationField } from '../data/elevation.js';
import { ONE, tileToScreen } from '../data/iso.js';
import { isVisible, type Viewport } from '../data/viewport.js';

/**
 * The DOOR-BADGE layer — a small stacked marker beside each staffed building's door showing how many
 * settlers work there (one badge per worker), drawn in WORLD space (a child of the camera's
 * `worldLayer`, ABOVE the sprite layer so it floats over the house) so it pans/zooms with the building.
 * Like the selection rings this is a CLIENT-side projection of the frozen snapshot, not sim state — the
 * app tallies each building's bound workers (the {@link DoorBadge} list) and this layer projects them.
 *
 * RETAINED, like the selection layer: one badge-stack {@link Container} per building id (a stable key),
 * rebuilt only when its worker/carrier counts change, otherwise just repositioned each frame; a stack
 * whose building left the badge list is destroyed. The stack anchors on the building's WORKER-ICON node
 * — the app's `computeDoorBadges` resolves it beside the door, with the per-building overrides — and is
 * projected via {@link tileToScreen} + the terrain lift (the same math the selection ring uses), growing
 * UPWARD from it — one square per person.
 *
 * The badge art is a PLACEHOLDER (coloured squares, one colour per worker ROLE — {@link CRAFTSMAN_COLOR}
 * vs {@link CARRIER_COLOR} vs {@link GATHERER_COLOR} so a tradesman, a hauler, and a gatherer each read
 * differently), a deliberate stand-in until the original round order-plate glyphs are wired; the layout,
 * stacking, and the three-way role split are the real behaviour. The app classifies each bound worker
 * into one of the three counts (see the sandbox `workerRoleOf`); this layer only draws them.
 */

/** One building's badge data: its worker-icon anchor position (snapshot `Position` fixed-point units,
 *  projected here) and the counts of settlers bound to it, split by worker ROLE so each draws its own
 *  colour. */
export interface DoorBadge {
  /** The building entity id — the retained-pool key (ids are monotonic, a stable key). */
  readonly id: number;
  /** Worker-icon anchor position in fixed-point `Position` units (same space as a snapshot `Position`). */
  readonly x: number;
  readonly y: number;
  /** In-workshop tradesmen (smith, joiner, …) bound here — drawn in {@link CRAFTSMAN_COLOR}. */
  readonly craftsmen: number;
  /** Carriers (haulers) bound here — drawn in {@link CARRIER_COLOR}. */
  readonly carriers: number;
  /** Gatherers bound here (e.g. the joinery's demo woodcutter) — drawn in {@link GATHERER_COLOR}. */
  readonly gatherers: number;
}

/** Placeholder square edge + vertical gap between stacked badges (world px). */
const SIZE = 9;
const GAP = 3;
/** px the stack's base sits BELOW its anchor node, so the squares stack UP the wall from ground
 *  level. The HORIZONTAL placement is the anchor's own: the app resolves the worker-icon node beside
 *  the door (with per-building overrides), so this layer adds no x offset. */
const STACK_BASE_DROP = 6;
/** Placeholder colours: one per worker role, with a dark outline so each reads on any ground. */
const CRAFTSMAN_COLOR = 0x5ab6ff; // blue — a workshop tradesman
const CARRIER_COLOR = 0xffbb33; // amber — a hauler (tragarz)
const GATHERER_COLOR = 0x7ed957; // green — a raw-good gatherer
const BORDER_COLOR = 0x1a1206;

interface BadgeStack {
  readonly node: Container;
  readonly craftsmen: number;
  readonly carriers: number;
  readonly gatherers: number;
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
   * no longer in the list. An empty list retires every stack. A `viewport` bounds the per-frame work to
   * the screen: a staffed building outside the framed box keeps its pooled stack (it scrolls back) but is
   * hidden and neither repositioned nor rebuilt, so cost tracks the screen, not the map's building count.
   */
  draw(badges: readonly DoorBadge[], elevation?: ElevationField, viewport?: Viewport): void {
    this.drawn.clear();
    for (const badge of badges) {
      if (badge.craftsmen + badge.carriers + badge.gatherers <= 0) continue;
      const tileX = badge.x / ONE;
      const tileY = badge.y / ONE;
      const p = tileToScreen(tileX, tileY);

      let stack = this.stacks.get(badge.id);
      // Off-screen: retain the pooled stack (hidden) so it isn't retired, but skip the reposition/rebuild;
      // a not-yet-built off-screen building simply waits to be built until it scrolls into view.
      if (viewport !== undefined && !isVisible(viewport, p.x, p.y)) {
        if (stack !== undefined) {
          stack.node.visible = false;
          this.drawn.add(badge.id);
        }
        continue;
      }
      const lift = elevation !== undefined && elevation.maxLift > 0 ? elevation.liftAt(tileX, tileY) : 0;

      if (
        stack === undefined ||
        stack.craftsmen !== badge.craftsmen ||
        stack.carriers !== badge.carriers ||
        stack.gatherers !== badge.gatherers
      ) {
        stack?.node.destroy({ children: true });
        const node = makeStack(badge.craftsmen, badge.carriers, badge.gatherers);
        this.container.addChild(node);
        stack = { node, craftsmen: badge.craftsmen, carriers: badge.carriers, gatherers: badge.gatherers };
        this.stacks.set(badge.id, stack);
      }
      stack.node.visible = true;
      stack.node.position.set(p.x, p.y - lift + STACK_BASE_DROP);
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

/** A door badge stack: one square per bound worker, grouped by role bottom-to-top — `carriers` (amber),
 *  then `craftsmen` (blue), then `gatherers` (green) — growing UP from the door anchor (row 0 is the
 *  lowest square, just above the door). */
function makeStack(craftsmen: number, carriers: number, gatherers: number): Container {
  const c = new Container();
  const colors = [
    ...new Array<number>(carriers).fill(CARRIER_COLOR),
    ...new Array<number>(craftsmen).fill(CRAFTSMAN_COLOR),
    ...new Array<number>(gatherers).fill(GATHERER_COLOR),
  ];
  colors.forEach((color, i) => {
    const yTop = -(i + 1) * (SIZE + GAP);
    const g = new Graphics();
    g.rect(0, yTop, SIZE, SIZE).fill({ color }).stroke({ width: 1, color: BORDER_COLOR, alpha: 0.9 });
    c.addChild(g);
  });
  return c;
}
