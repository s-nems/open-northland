import { Container, Graphics } from 'pixi.js';
import { isVisible, ONE, tileToScreen, type Viewport } from '../../data/projection/index.js';
import { type ElevationField, terrainLiftAt } from '../../data/terrain/index.js';
import { retainOffscreen, retireUndrawn } from './retained-pool.js';

/**
 * The door-badge layer — a small stacked marker beside each staffed building's door showing how many
 * settlers work there (one badge per worker), drawn in world space (a child of the camera's
 * `worldLayer`, above the sprite layer so it floats over the house) so it pans/zooms with the building.
 * Like the selection rings this is a client-side projection of the read-only snapshot, not sim state. The
 * app tallies each building's bound workers (the {@link DoorBadge} list) and this layer projects them.
 *
 * Retained, like the selection layer: one badge-stack {@link Container} per building id (a stable key),
 * rebuilt only when its worker/carrier counts change, otherwise just repositioned each frame; a stack
 * whose building left the badge list is destroyed. The stack anchors on the building's worker-icon node
 * — the app's `computeDoorBadges` resolves it beside the door, with the per-building overrides — and is
 * projected via {@link tileToScreen} + the terrain lift (the same math the selection ring uses), growing
 * upward from it — one square per person.
 *
 * The badge art is a placeholder — coloured squares, one colour per worker role ({@link CRAFTSMAN_COLOR}/
 * {@link CARRIER_COLOR}/{@link GATHERER_COLOR}, so tradesman/hauler/gatherer read differently) until the
 * original round order-plate glyphs are wired; the layout, stacking, and three-way role split are the real
 * behaviour. The app classifies each bound worker into one of the three counts (sandbox `workerRoleOf`).
 */

/** One family living in a home, as its door dot reads it: a single, a childless couple, or a couple
 *  with their growing child — each draws its own dot colour. */
export type HouseholdKind = 'single' | 'couple' | 'family';

/** One building's badge data: its worker-icon anchor position (snapshot `Position` fixed-point units,
 *  projected here) and the counts of settlers bound to it, split by worker role so each draws its own
 *  colour — plus, for a home, its resident family dot and the make-love hearts. */
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
  /** The families living in this home — one round dot each (`homeSize` counts families); absent/empty
   *  = nobody lives here. */
  readonly households?: readonly HouseholdKind[];
  /** True while the resident couple makes love here — draws the hearts over the house. */
  readonly hearts?: boolean;
}

/** Placeholder square edge + vertical gap between stacked badges (world px). */
const SIZE = 9;
const GAP = 3;
/** px the stack's base sits below its anchor node, so the squares stack up the wall from ground level.
 *  Horizontal placement is the anchor's own (no x offset added here). */
const STACK_BASE_DROP = 6;
/** Placeholder colours: one per worker role, with a dark outline so each reads on any ground. */
const CRAFTSMAN_COLOR = 0x5ab6ff; // blue — a workshop tradesman
const CARRIER_COLOR = 0xffbb33; // amber — a hauler (tragarz)
const GATHERER_COLOR = 0x7ed957; // green — a raw-good gatherer
const BORDER_COLOR = 0x1a1206;
/** Household dot colours — one per family shape ({@link HouseholdKind}), round so it reads apart from
 *  the square worker badges. */
const HOUSEHOLD_COLOR: Readonly<Record<HouseholdKind, number>> = {
  single: 0xd9d9d9, // grey — one settler lives here
  couple: 0xff7a9c, // pink — a married couple
  family: 0xffd24d, // gold — a couple raising a child
};
/** Hearts (make-love) drawing: colour, per-heart radius and the column they float in above the stack. */
const HEART_COLOR = 0xff4d78;
const HEART_RADIUS = 3.5;
const HEART_GAP = 12;
const HEART_LIFT = 26; // px above the stack's top — "hearts over the house"
const HEART_DRIFT = 4; // px of horizontal drift per heart, so the column reads as rising, not stacked
const HEART_COUNT = 3;

interface BadgeStack {
  readonly node: Container;
  readonly craftsmen: number;
  readonly carriers: number;
  readonly gatherers: number;
  /** The drawn family dots, joined into a change-detection key ('' = none). */
  readonly households: string;
  readonly hearts: boolean;
}

/** A badge's family-dot list as a change-detection key (order matters — it is the drawn order). */
function householdsKey(badge: DoorBadge): string {
  return badge.households?.join(',') ?? '';
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
      const empty =
        badge.craftsmen + badge.carriers + badge.gatherers <= 0 &&
        (badge.households === undefined || badge.households.length === 0) &&
        badge.hearts !== true;
      if (empty) continue;
      const tileX = badge.x / ONE;
      const tileY = badge.y / ONE;
      const p = tileToScreen(tileX, tileY);

      let stack = this.stacks.get(badge.id);
      // Off-screen: retain the pooled stack (hidden) so it isn't retired, but skip the reposition/rebuild.
      // An id whose stack doesn't exist yet is deliberately not marked drawn (see {@link retainOffscreen}).
      if (viewport !== undefined && !isVisible(viewport, p.x, p.y)) {
        retainOffscreen(stack?.node, badge.id, this.drawn);
        continue;
      }
      const lift = terrainLiftAt(elevation, tileX, tileY);

      if (
        stack === undefined ||
        stack.craftsmen !== badge.craftsmen ||
        stack.carriers !== badge.carriers ||
        stack.gatherers !== badge.gatherers ||
        stack.households !== householdsKey(badge) ||
        stack.hearts !== (badge.hearts === true)
      ) {
        stack?.node.destroy({ children: true });
        const node = makeStack(badge);
        this.container.addChild(node);
        stack = {
          node,
          craftsmen: badge.craftsmen,
          carriers: badge.carriers,
          gatherers: badge.gatherers,
          households: householdsKey(badge),
          hearts: badge.hearts === true,
        };
        this.stacks.set(badge.id, stack);
      }
      stack.node.visible = true;
      stack.node.position.set(p.x, p.y - lift + STACK_BASE_DROP);
      this.drawn.add(badge.id);
    }
    // Retire stacks not drawn this frame (building demolished, unstaffed, or left the snapshot).
    retireUndrawn(this.stacks, this.drawn, (stack) => stack.node.destroy({ children: true }));
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.stacks.clear();
  }
}

/** A door badge stack: one square per bound worker, grouped by role bottom-to-top — `carriers` (amber),
 *  then `craftsmen` (blue), then `gatherers` (green) — growing up from the door anchor (row 0 is the
 *  lowest square, just above the door). A home's family dots stack at the base, one round dot per
 *  resident family (round, so they read apart from the squares), and the make-love hearts float in a
 *  short column above it all. */
function makeStack(badge: DoorBadge): Container {
  const c = new Container();
  let rows = 0;
  for (const household of badge.households ?? []) {
    const g = new Graphics();
    const yCentre = -(rows + 1) * (SIZE + GAP) + SIZE / 2;
    g.circle(SIZE / 2, yCentre, SIZE / 2)
      .fill({ color: HOUSEHOLD_COLOR[household] })
      .stroke({ width: 1, color: BORDER_COLOR, alpha: 0.9 });
    c.addChild(g);
    rows++;
  }
  const colors = [
    ...new Array<number>(badge.carriers).fill(CARRIER_COLOR),
    ...new Array<number>(badge.craftsmen).fill(CRAFTSMAN_COLOR),
    ...new Array<number>(badge.gatherers).fill(GATHERER_COLOR),
  ];
  for (const color of colors) {
    const yTop = -(rows + 1) * (SIZE + GAP);
    const g = new Graphics();
    g.rect(0, yTop, SIZE, SIZE).fill({ color }).stroke({ width: 1, color: BORDER_COLOR, alpha: 0.9 });
    c.addChild(g);
    rows++;
  }
  if (badge.hearts === true) {
    const top = -(rows * (SIZE + GAP)) - HEART_LIFT;
    for (let i = 0; i < HEART_COUNT; i++) {
      c.addChild(makeHeart(SIZE / 2 + (i - 1) * HEART_DRIFT, top - i * HEART_GAP));
    }
  }
  return c;
}

/** One small heart at (`x`, `y`): two lobes + a point, in {@link HEART_COLOR}. */
function makeHeart(x: number, y: number): Graphics {
  const g = new Graphics();
  const r = HEART_RADIUS;
  g.circle(x - r * 0.6, y - r * 0.4, r * 0.7)
    .circle(x + r * 0.6, y - r * 0.4, r * 0.7)
    .poly([x - r * 1.25, y - r * 0.1, x + r * 1.25, y - r * 0.1, x, y + r * 1.4])
    .fill({ color: HEART_COLOR });
  return g;
}
