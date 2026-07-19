import { Container, Graphics } from 'pixi.js';
import {
  damageSmokeEmitters,
  emitterSpot,
  MAX_SMOKE_EMITTERS,
  SMOKE_PUFFS_PER_EMITTER,
  smokePuff,
} from '../../data/effects/index.js';
import type { EntityBounds } from '../sprite-pool/index.js';
import { retireUndrawn } from './retained-pool.js';

/** The pale ash-grey a puff draws in — one flat circle per puff; density comes from the overlap.
 *  Light, not dark: the plumes rise over the dark roof palette, where a dark grey disappears. */
const SMOKE_COLOUR = 0xc4c4c4;

/**
 * The damage-smoke overlay — the more battered a building, the more smoke pours off it: one seeded
 * plume per fifth of its Health pool lost ({@link damageSmokeEmitters}), each a phase-staggered loop of
 * rising, swelling, thinning grey puffs ({@link smokePuff}). Driven per frame from the sprite pool's
 * already-culled damaged-building list and its per-entity sprite bounds, so smoke rises from the actual
 * roofline and the cost tracks the screen. A pure function of the CURRENT HP fraction — repairs or an
 * upgrade refill shed the plumes with no event wiring. Retained: one node per building, all
 * {@link MAX_SMOKE_EMITTERS}×{@link SMOKE_PUFFS_PER_EMITTER} puffs minted once, surplus emitters hidden.
 */
export class DamageSmokeLayer {
  /** World-space, added above the sprite layer — smoke floats over the roofs (like the blood overlay). */
  readonly container = new Container();
  /** One retained node per smoking building, keyed by entity ref. */
  private readonly nodes = new Map<string, Container>();
  /** Reused per-frame scratch of keys drawn this frame. */
  private readonly seen = new Set<string>();

  /**
   * Reposition every plume for this frame. `damaged` is the pool's culled damaged-building list;
   * `boundsOf` its per-entity world-space sprite bounds (undefined while not drawn — the node is then
   * retired and re-minted on scroll-back, cheap for a handful of Graphics). `tick` is interpolated
   * render time, so the rise glides between sim ticks.
   */
  draw(
    damaged: readonly { ref: number; hpFrac: number }[],
    boundsOf: (ref: number) => EntityBounds | undefined,
    tick: number,
  ): void {
    this.seen.clear();
    for (const { ref, hpFrac } of damaged) {
      const emitters = damageSmokeEmitters(hpFrac);
      if (emitters <= 0) continue;
      const bounds = boundsOf(ref);
      if (bounds === undefined) continue; // not drawn this frame (culled/hidden) — retire below
      const key = String(ref);
      let node = this.nodes.get(key);
      if (node === undefined) {
        node = makeSmokeNode();
        this.container.addChild(node);
        this.nodes.set(key, node);
      }
      node.visible = true;
      placePlumes(node, ref, emitters, bounds, tick);
      this.seen.add(key);
    }
    retireUndrawn(this.nodes, this.seen, (node) => node.destroy({ children: true }));
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.nodes.clear();
  }
}

/** Mint a building's smoke node: one sub-container per possible emitter, each holding its staggered
 *  puffs (unit circles the per-frame pass scales/moves/fades). Minted at the max once — the per-frame
 *  emitter count only toggles visibility, so worsening damage allocates nothing. */
function makeSmokeNode(): Container {
  const node = new Container();
  for (let e = 0; e < MAX_SMOKE_EMITTERS; e++) {
    const emitter = new Container();
    for (let p = 0; p < SMOKE_PUFFS_PER_EMITTER; p++) {
      emitter.addChild(new Graphics().circle(0, 0, 1).fill({ color: SMOKE_COLOUR }));
    }
    node.addChild(emitter);
  }
  return node;
}

/** Place the node's plumes for this frame: the first `emitters` sub-containers sit at their seeded roof
 *  spots inside `bounds`, each puff posed by {@link smokePuff}; the rest are hidden. */
function placePlumes(
  node: Container,
  seed: number,
  emitters: number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  tick: number,
): void {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  for (let e = 0; e < node.children.length; e++) {
    const emitter = node.children[e] as Container;
    const active = e < emitters;
    emitter.visible = active;
    if (!active) continue;
    const spot = emitterSpot(seed, e);
    emitter.position.set(bounds.minX + spot.u * w, bounds.minY + spot.v * h);
    for (let p = 0; p < emitter.children.length; p++) {
      const puff = emitter.children[p] as Graphics;
      const pose = smokePuff(seed, e, p, tick);
      puff.position.set(pose.x, pose.y);
      puff.scale.set(pose.radius);
      puff.alpha = pose.alpha;
    }
  }
}
