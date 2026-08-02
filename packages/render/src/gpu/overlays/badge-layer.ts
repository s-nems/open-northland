import { Container, Graphics, Sprite } from 'pixi.js';
import { isVisible, ONE, tileToScreen, type Viewport } from '../../data/projection/index.js';
import { SIGN_DEPTH_EPS, screenDepth } from '../../data/scene/index.js';
import { type ElevationField, terrainLiftAt } from '../../data/terrain/index.js';
import type { TextureCache } from '../texture-cache.js';
import { retainOffscreen, retireUndrawn } from './retained-pool.js';
import {
  type BuildingSignSheet,
  chainedFrame,
  type DoorBadgeRole,
  type HouseholdKind,
  IDENTITY_COLOUR,
  SIGN_HEIGHT,
  SIGN_STEP,
  type SignGfx,
  sheetFor,
  signKindOf,
} from './sign-gfx.js';

// Re-exported so app-side DoorBadge producers keep importing them from the badge layer they feed.
export type { DoorBadgeRole, HouseholdKind } from './sign-gfx.js';

/**
 * The door-badge layer - a stacked marker at each staffed building's sign post showing who works there
 * (one sign per settler) and, for a home, its resident families. Like the selection rings this is a
 * client-side projection of the read-only snapshot, not sim state: the app's `computeDoorBadges`
 * resolves each building's anchor and its bottom-to-top {@link DoorBadgeRow} list; this layer only
 * draws them.
 *
 * The stacks live in the depth-sorted sprite layer, not a painter slot of their own, keyed just above
 * the OWNING BUILDING's {@link screenDepth} ({@link SIGN_DEPTH_EPS}) rather than the post's own planted
 * spot: the chain clears its house whichever side the post stands on, and every unit from the house's
 * row forward paints over it. APPROXIMATION - how the original sorts its sign records against units is
 * not established here; this rule is chosen so a marker never swallows the unit the player is watching,
 * at the cost of a band between house anchor and post where a settler is drawn in front of a post he
 * stands behind (measured against the shipped data in the layer's test). Off-screen stacks detach, so
 * this layer's share of the depth sort tracks the screen.
 *
 * Retained, like the selection layer: one badge-stack {@link Container} per building id (a stable key),
 * rebuilt only when its rows, family banners, or owner change, otherwise just repositioned each frame;
 * a stack whose building left the badge list is destroyed.
 *
 * The badge art is the original's player-coloured `ls_temp` signs (see `sign-gfx.ts` for the shared
 * contract, chain layout, and fallback rules); without decoded art the layer draws the placeholder
 * coloured squares/dots instead.
 */

/** One drawn sign row of a badge: its role (which sign it draws) and, when the marker stands for one
 *  settler, that settler's entity id - the click-pick target the app resolves. */
export interface DoorBadgeRow {
  readonly role: DoorBadgeRole;
  readonly settler?: number;
}

/** One building's badge data: its stack anchor (snapshot `Position` fixed-point units + an optional
 *  screen-px offset) and the bottom-to-top sign rows bound to it. */
export interface DoorBadge {
  /** The building entity id - the retained-pool key (ids are monotonic, a stable key). */
  readonly id: number;
  /** The OWNING BUILDING's position in fixed-point `Position` units (same space as a snapshot
   *  `Position`) - the depth key, so the stack sorts with its house wherever the post stands. */
  readonly x: number;
  readonly y: number;
  /** Screen-px offset from the projected anchor to the post (+y down); absent = 0. The original's
   *  `GfxFlagPoint`, or the projected step to the derived worker-icon node when a type has none. */
  readonly dx?: number;
  readonly dy?: number;
  /** The owning player slot (0-based `Owner.player`) - selects the sign recolour. */
  readonly player?: number;
  /** Bottom-to-top sign rows. The projection owns the order (families at the base, worker discs, then
   *  carrier pennants on top); this layer draws them as given. */
  readonly rows: readonly DoorBadgeRow[];
  /** True while the resident couple makes love here - draws the hearts over the house. */
  readonly hearts?: boolean;
}

/** Placeholder square edge + vertical gap between stacked badges (world px). */
const SIZE = 9;
const GAP = 3;
/** px the placeholder stack's base sits below its anchor node, so the squares stack up the wall from
 *  ground level. */
const STACK_BASE_DROP = 6;
/** Placeholder colours: one per worker role, with a dark outline so each reads on any ground. */
const ROLE_COLOR: Readonly<Record<'craftsman' | 'carrier' | 'gatherer', number>> = {
  craftsman: 0x5ab6ff, // blue - a workshop tradesman
  carrier: 0xffbb33, // amber - a hauler (tragarz)
  gatherer: 0x7ed957, // green - a raw-good gatherer
};
const BORDER_COLOR = 0x1a1206;
/** Placeholder household dot colours - one per family shape ({@link HouseholdKind}). */
const HOUSEHOLD_COLOR: Readonly<Record<HouseholdKind, number>> = {
  single: 0xd9d9d9, // grey - one settler lives here
  couple: 0xff7a9c, // pink - a married couple
  family: 0xffd24d, // gold - a couple raising a child
};
/** Hearts (make-love) drawing: colour, per-heart radius and the column they float in above the stack. */
const HEART_COLOR = 0xff4d78;
const HEART_RADIUS = 3.5;
const HEART_GAP = 12;
const HEART_LIFT = 26; // px above the stack's top - "hearts over the house"
const HEART_DRIFT = 4; // px of horizontal drift per heart, so the column reads as rising, not stacked
const HEART_COUNT = 3;

interface BadgeStack {
  readonly node: Container;
  /** The drawn rows joined into a change-detection key ('' = none). */
  readonly rows: string;
  readonly hearts: boolean;
  /** The player recolour the stack was built with (0 when drawing the player-agnostic placeholder
   *  squares, so an owner change never rebuilds a visually identical square stack). The art basis
   *  itself is not part of the key - it changes only through {@link BadgeLayer.setGfx}, which clears
   *  the pool. */
  readonly player: number;
  /** px added below the anchor when positioning (the placeholder squares sit slightly lower). */
  readonly baseDrop: number;
}

/** A badge's row roles as a change-detection key (order matters - it is the drawn order). A settler
 *  swap behind an identical row list draws the same art, so ids stay out of the key. */
function rowsKey(badge: DoorBadge): string {
  let key = '';
  for (const row of badge.rows) key += `${row.role},`;
  return key;
}

export class BadgeLayer {
  /** One persistent badge-stack per building id; rebuilt only when its rows change, else repositioned. */
  private readonly stacks = new Map<number, BadgeStack>();
  /** Reused per-frame scratch of ids drawn this frame (avoids a per-frame allocation). */
  private readonly drawn = new Set<number>();
  /** The decoded sign art; unset draws the placeholder squares. */
  private gfx: SignGfx | undefined;
  /** Session owner→colour-slot mapping - the same one pooled sprites draw through, so a building's
   *  door signs match its settlers' clothing band on a rostered map. */
  private readonly colourOf: (player: number) => number;

  constructor(
    /** The renderer's depth-sorted sprite layer - badge stacks interleave with the live sprites. */
    private readonly spriteLayer: Container,
    colourOf: (player: number) => number = IDENTITY_COLOUR,
  ) {
    this.colourOf = colourOf;
  }

  /** Provide (or clear) the decoded `ls_temp` sign art. Every live stack is retired so the next draw
   *  rebuilds against the new art basis. */
  setGfx(gfx: SignGfx | undefined): void {
    this.gfx = gfx;
    for (const s of this.stacks.values()) s.node.destroy({ children: true });
    this.stacks.clear();
  }

  /**
   * Reconcile the badge stacks to `badges`: get-or-(re)build a stack per building whose rows changed,
   * move it to the building's anchor (projected + terrain-lifted) and re-key its depth, then destroy
   * stacks for buildings no longer in the list. An empty list retires every stack. A `viewport` bounds
   * the per-frame work to the screen: a staffed building outside the framed box keeps its pooled stack
   * (it scrolls back) but is detached and neither repositioned nor rebuilt, so cost tracks the screen,
   * not the map's building count.
   */
  draw(badges: readonly DoorBadge[], elevation?: ElevationField, viewport?: Viewport): void {
    this.drawn.clear();
    for (const badge of badges) {
      if (badge.rows.length === 0 && badge.hearts !== true) continue;
      const tileX = badge.x / ONE;
      const tileY = badge.y / ONE;
      const p = tileToScreen(tileX, tileY);

      let stack = this.stacks.get(badge.id);
      // Off-screen: retain the pooled stack so it isn't retired, but skip the reposition/rebuild and drop
      // it out of the sprite layer, whose depth sort runs over its children every frame. An id whose stack
      // doesn't exist yet is deliberately not marked drawn (see {@link retainOffscreen}).
      if (viewport !== undefined && !isVisible(viewport, p.x, p.y)) {
        retainOffscreen(stack?.node, badge.id, this.drawn);
        stack?.node.removeFromParent();
        continue;
      }
      const lift = terrainLiftAt(elevation, tileX, tileY);

      const colour = this.colourOf(badge.player ?? 0);
      const sheet = this.gfx === undefined ? undefined : sheetFor(this.gfx, colour);
      const player = sheet === undefined ? 0 : colour;
      const rows = rowsKey(badge);
      if (
        stack === undefined ||
        stack.rows !== rows ||
        stack.hearts !== (badge.hearts === true) ||
        stack.player !== player
      ) {
        stack?.node.destroy({ children: true });
        const node =
          this.gfx !== undefined && sheet !== undefined
            ? makeSignStack(badge, this.gfx.textures, sheet)
            : makeSquareStack(badge);
        stack = {
          node,
          rows,
          hearts: badge.hearts === true,
          player,
          baseDrop: sheet !== undefined ? 0 : STACK_BASE_DROP,
        };
        this.stacks.set(badge.id, stack);
      }
      stack.node.visible = true;
      if (stack.node.parent === null) this.spriteLayer.addChild(stack.node);
      stack.node.position.set(p.x + (badge.dx ?? 0), p.y + (badge.dy ?? 0) - lift + stack.baseDrop);
      // `p` is the PRE-lift projection the line above then lifts - the same key the pool builds a
      // building from, so the chain sorts with its house on a hill too.
      stack.node.zIndex = screenDepth(p.x, p.y, 'building') + SIGN_DEPTH_EPS;
      this.drawn.add(badge.id);
    }
    // Retire stacks not drawn this frame (building demolished, unstaffed, or left the snapshot).
    retireUndrawn(this.stacks, this.drawn, (stack) => stack.node.destroy({ children: true }));
  }

  destroy(): void {
    for (const stack of this.stacks.values()) stack.node.destroy({ children: true });
    this.stacks.clear();
  }
}

/** A door badge stack drawn from the decoded sign art: one player-coloured sign sprite per row,
 *  chained upward from the anchor ({@link SIGN_STEP}) - rows above the base draw their base-cropped
 *  variant ({@link chainedFrame}) so no rock clump lands on the emblem below - with the make-love
 *  hearts floating above. */
function makeSignStack(badge: DoorBadge, textures: TextureCache, sheet: BuildingSignSheet): Container {
  const c = new Container();
  let rows = 0;
  for (const row of badge.rows) {
    const kind = signKindOf(row.role);
    const base = sheet.frameByKind[kind];
    const frame = rows === 0 ? base : chainedFrame(kind, base);
    const s = new Sprite(textures.get(sheet.source, frame));
    s.position.set(frame.offsetX, -(rows * SIGN_STEP) + frame.offsetY);
    c.addChild(s);
    rows++;
  }
  if (badge.hearts === true) {
    const top = -((rows - 1) * SIGN_STEP) - SIGN_HEIGHT - HEART_LIFT;
    for (let i = 0; i < HEART_COUNT; i++) {
      c.addChild(makeHeart((i - 1) * HEART_DRIFT, top - i * HEART_GAP));
    }
  }
  return c;
}

/** The placeholder stack (no decoded art): the same bottom-to-top rows as the sign chain, drawn as a
 *  coloured square per worker ({@link ROLE_COLOR}) and a round dot per resident family (round, so they
 *  read apart from the squares), growing up from the anchor, with the make-love hearts in a short
 *  column above it all. */
function makeSquareStack(badge: DoorBadge): Container {
  const c = new Container();
  let rows = 0;
  for (const row of badge.rows) {
    const g = new Graphics();
    if (row.role === 'single' || row.role === 'couple' || row.role === 'family') {
      const yCentre = -(rows + 1) * (SIZE + GAP) + SIZE / 2;
      g.circle(SIZE / 2, yCentre, SIZE / 2)
        .fill({ color: HOUSEHOLD_COLOR[row.role] })
        .stroke({ width: 1, color: BORDER_COLOR, alpha: 0.9 });
    } else {
      const yTop = -(rows + 1) * (SIZE + GAP);
      g.rect(0, yTop, SIZE, SIZE)
        .fill({ color: ROLE_COLOR[row.role] })
        .stroke({ width: 1, color: BORDER_COLOR, alpha: 0.9 });
    }
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
