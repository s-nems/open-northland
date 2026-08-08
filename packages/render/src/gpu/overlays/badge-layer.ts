import type { Container } from 'pixi.js';
import { isVisible, ONE, tileToScreen, type Viewport } from '../../data/projection/index.js';
import { SIGN_DEPTH_EPS, screenDepth } from '../../data/scene/index.js';
import { type ElevationField, terrainLiftAt } from '../../data/terrain/index.js';
import { makeSignStack, makeSquareStack, STACK_BASE_DROP } from './badge-stack.js';
import { GARRISON_STAR_MAX, makeGarrisonFlag } from './garrison-flag.js';
import { retainOffscreen, retireUndrawn } from './retained-pool.js';
import {
  type BuildingSignSheet,
  type DoorBadgeRow,
  IDENTITY_COLOUR,
  type SignGfx,
  sheetFor,
} from './sign-gfx.js';

// Re-exported so app-side DoorBadge producers import them from the layer they feed.
export type { DoorBadgeRole, DoorBadgeRow, HouseholdKind } from './sign-gfx.js';

/**
 * The door-badge layer - a stacked marker at each staffed building's sign post showing who works there
 * (one sign per settler) and, for a home, its resident families. The app's `computeDoorBadges` resolves
 * each building's anchor and rows; this layer draws them.
 *
 * Stacks key just above the owning building's depth rather than the post's own planted spot, so a marker
 * never swallows the unit the player is watching, at the cost of a band between house anchor and post
 * where a settler draws in front of a post he stands behind. Approximation: how the original sorts its
 * sign records against units is not established.
 */

/** One building's badge data: its stack anchor (snapshot `Position` fixed-point units + an optional
 *  screen-px offset) and the bottom-to-top sign rows bound to it. */
export interface DoorBadge {
  /** The building entity id - the retained-pool key. */
  readonly id: number;
  /** The owning building's position in fixed-point `Position` units - the depth key, so the stack sorts
   *  with its house wherever the post stands. */
  readonly x: number;
  readonly y: number;
  /** Screen-px offset from the projected anchor to the post (+y down); absent = 0. The original's
   *  `GfxFlagPoint`, or the projected step to the derived worker-icon node when a type has none. */
  readonly dx?: number;
  readonly dy?: number;
  /** The owning player slot (0-based `Owner.player`) - selects the sign recolour. */
  readonly player?: number;
  /** Bottom-to-top sign rows; the projection owns the order and this layer draws them as given. */
  readonly rows: readonly DoorBadgeRow[];
  /** True while the resident couple makes love here - draws the hearts over the house. */
  readonly hearts?: boolean;
  /** The garrison this building's roof flies a flag for - the men posted to it, not the ones currently up
   *  there, so the flag does not drop a star every time one climbs down for a meal. Its soldiers stay out
   *  of `rows`: the flag stands for the whole post, one star per man, at its own screen-px offset from
   *  the projected anchor (the mast point, +y down). */
  readonly garrison?: {
    readonly stars: number;
    readonly dx: number;
    readonly dy: number;
  };
}

interface BadgeStack {
  readonly node: Container;
  /** The garrison flag, flown from the building's mast. A sibling of the chain in the sprite layer, not
   *  its child: the two marks stand at different anchors but pool, cull and sort as one building. */
  readonly flag?: Container | undefined;
  readonly advanceFlag?: ((clock: number) => void) | undefined;
  /** The drawn rows joined into a change-detection key ('' = none). */
  readonly rows: string;
  readonly hearts: boolean;
  /** Stars flown this build (0 = no garrison) - part of the key, so a man joining or leaving the post
   *  swaps the flag. */
  readonly stars: number;
  /** The player recolour the stack was built with, 0 for the player-agnostic placeholder squares, so an
   *  owner change never rebuilds a visually identical square stack. */
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
  /** One persistent badge-stack per building id; rebuilt when its rows, hearts, stars or colour change,
   *  else repositioned. */
  private readonly stacks = new Map<number, BadgeStack>();
  /** Reused scratch of ids drawn this frame, to avoid a per-frame allocation. */
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
   *  rebuilds against it, which is why the art stays out of the per-stack rebuild key. */
  setGfx(gfx: SignGfx | undefined): void {
    this.gfx = gfx;
    for (const s of this.stacks.values()) destroyStack(s);
    this.stacks.clear();
  }

  /**
   * Reconcile the badge stacks to `badges`, retiring stacks for buildings no longer in the list. A
   * building outside `viewport` keeps its pooled stack but is detached and neither repositioned nor
   * rebuilt, so cost tracks the screen and not the map's building count. `clock` is the render clock in
   * sim ticks, which the on-screen garrison flags wave on.
   */
  draw(badges: readonly DoorBadge[], elevation?: ElevationField, viewport?: Viewport, clock = 0): void {
    this.drawn.clear();
    for (const badge of badges) {
      if (badge.rows.length === 0 && badge.hearts !== true && badge.garrison === undefined) continue;
      const tileX = badge.x / ONE;
      const tileY = badge.y / ONE;
      const p = tileToScreen(tileX, tileY);

      let stack = this.stacks.get(badge.id);
      // Off-screen: retain the pooled stack so it isn't retired, but skip the reposition/rebuild and drop
      // it out of the sprite layer, whose depth sort runs over its children every frame. An id whose stack
      // doesn't exist yet stays unmarked (see {@link retainOffscreen}).
      if (viewport !== undefined && !isVisible(viewport, p.x, p.y)) {
        retainOffscreen(stack?.node, badge.id, this.drawn);
        stack?.node.removeFromParent();
        stack?.flag?.removeFromParent();
        continue;
      }
      const lift = terrainLiftAt(elevation, tileX, tileY);

      const colour = this.colourOf(badge.player ?? 0);
      const sheet = this.gfx === undefined ? undefined : sheetFor(this.gfx, colour);
      const player = sheet === undefined ? 0 : colour;
      const rows = rowsKey(badge);
      // Capped here, so the key is what the flag looks like: the sixth man onto a post does not rebuild
      // a stack that would draw the same five stars.
      const stars = Math.min(badge.garrison?.stars ?? 0, GARRISON_STAR_MAX);
      if (
        stack === undefined ||
        stack.rows !== rows ||
        stack.hearts !== (badge.hearts === true) ||
        stack.stars !== stars ||
        stack.player !== player
      ) {
        destroyStack(stack);
        stack = this.build(badge, sheet, rows, player, stars);
        this.stacks.set(badge.id, stack);
      }
      stack.node.visible = true;
      if (stack.node.parent === null) this.spriteLayer.addChild(stack.node);
      stack.node.position.set(p.x + (badge.dx ?? 0), p.y + (badge.dy ?? 0) - lift + stack.baseDrop);
      // `p` is the pre-lift projection the line above then lifts - the same key the pool builds a
      // building from, so the chain sorts with its house on a hill too.
      const depth = screenDepth(p.x, p.y, 'building') + SIGN_DEPTH_EPS;
      stack.node.zIndex = depth;
      if (stack.flag !== undefined && badge.garrison !== undefined) {
        stack.flag.visible = true;
        if (stack.flag.parent === null) this.spriteLayer.addChild(stack.flag);
        stack.flag.position.set(p.x + badge.garrison.dx, p.y + badge.garrison.dy - lift);
        // Its building's key, like the chain. A type with no authored mast plants both marks on the
        // same anchor; the flag is added second, and the depth sort is stable, so it stays on top.
        stack.flag.zIndex = depth;
        stack.advanceFlag?.(clock);
      }
      this.drawn.add(badge.id);
    }
    // A stack goes undrawn when its building was demolished, unstaffed, or left the snapshot.
    retireUndrawn(this.stacks, this.drawn, destroyStack);
  }

  /** One building's marks: the sign chain, and the garrison flag when the post is manned. */
  private build(
    badge: DoorBadge,
    sheet: BuildingSignSheet | undefined,
    rows: string,
    player: number,
    stars: number,
  ): BadgeStack {
    const gfx = this.gfx;
    const hearts = badge.hearts === true;
    const node =
      gfx !== undefined && sheet !== undefined
        ? makeSignStack(badge.rows, hearts, gfx.textures, sheet)
        : makeSquareStack(badge.rows, hearts);
    const baseDrop = sheet === undefined ? STACK_BASE_DROP : 0;
    const base = { node, rows, hearts, stars, player, baseDrop };
    // Gated on the capped `stars`, not on `garrison` being present: `stars` is the whole garrison term
    // in the rebuild key, and a zero-star garrison keys the same as none, so such a flag never retires.
    if (badge.garrison === undefined || stars < 1) return base;
    const flag = makeGarrisonFlag(stars, gfx?.textures, sheet);
    return { ...base, flag: flag.node, advanceFlag: flag.advance };
  }

  destroy(): void {
    for (const stack of this.stacks.values()) destroyStack(stack);
    this.stacks.clear();
  }
}

function destroyStack(stack: BadgeStack | undefined): void {
  stack?.node.destroy({ children: true });
  stack?.flag?.destroy({ children: true });
}
