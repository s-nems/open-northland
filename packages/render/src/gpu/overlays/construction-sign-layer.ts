import { Container, Sprite } from 'pixi.js';
import { isVisible, ONE, tileToScreen, type Viewport } from '../../data/projection/index.js';
import { type ElevationField, terrainLiftAt } from '../../data/terrain/index.js';
import { retainOffscreen, retireUndrawn } from './retained-pool.js';
import { IDENTITY_COLOUR, type SignGfx, sheetFor } from './sign-gfx.js';

/**
 * The construction-sign layer - one player-coloured `ls_temp` stand planted at each building site's
 * sign post. A client-side projection of the read-only snapshot: the app's `computeConstructionSigns`
 * decides what counts as a site and where its post is.
 *
 * Unlike the door-badge chain that replaces it when the site completes, the stand keeps its painter
 * slot above the sprites: it marks a site the builders crowd around, so it stays readable through them.
 *
 * Retained per site id with the shared viewport-cull dance ({@link retainOffscreen} /
 * {@link retireUndrawn}); a sprite is rebuilt only when the site's owner changes, else repositioned.
 */
export interface ConstructionSign {
  /** The building entity id - the retained-pool key. */
  readonly id: number;
  /** Anchor position in fixed-point `Position` units (same space as a snapshot `Position`). */
  readonly x: number;
  readonly y: number;
  /** Screen-px offset from the projected anchor - the original's `GfxFlagPoint` (+y down); absent = 0. */
  readonly dx?: number;
  readonly dy?: number;
  /** The owning player slot (0-based `Owner.player`) - selects the sign recolour. */
  readonly player?: number;
}

/** One planted construction sign, keyed by site building id. */
interface SignNode {
  readonly node: Sprite;
  readonly player: number;
}

export class ConstructionSignLayer {
  readonly container = new Container();
  /** One persistent sign per site building id; rebuilt only on owner change, else repositioned. */
  private readonly signs = new Map<number, SignNode>();
  /** Reused per-frame scratch of ids drawn this frame (avoids a per-frame allocation). */
  private readonly drawn = new Set<number>();
  /** The decoded sign art; unset draws nothing (the plot overlay already marks a fallback-boot site). */
  private gfx: SignGfx | undefined;
  /** Session owner→colour-slot mapping - the same one pooled sprites draw through. */
  private readonly colourOf: (player: number) => number;

  constructor(colourOf: (player: number) => number = IDENTITY_COLOUR) {
    this.colourOf = colourOf;
  }

  /** Provide (or clear) the decoded sign art. Every live sign is retired so the next draw rebuilds
   *  against the new art basis. */
  setGfx(gfx: SignGfx | undefined): void {
    this.gfx = gfx;
    for (const s of this.signs.values()) s.node.destroy();
    this.signs.clear();
  }

  /** Reconcile the planted signs to `signs`, with the same screen-bounded cull as the badge stacks. */
  draw(signs: readonly ConstructionSign[], elevation?: ElevationField, viewport?: Viewport): void {
    this.drawn.clear();
    const gfx = this.gfx;
    if (gfx !== undefined) {
      for (const sign of signs) {
        const tileX = sign.x / ONE;
        const tileY = sign.y / ONE;
        const p = tileToScreen(tileX, tileY);
        let entry = this.signs.get(sign.id);
        if (viewport !== undefined && !isVisible(viewport, p.x, p.y)) {
          retainOffscreen(entry?.node, sign.id, this.drawn);
          continue;
        }
        const player = this.colourOf(sign.player ?? 0);
        if (entry === undefined || entry.player !== player) {
          if (entry !== undefined) {
            entry.node.destroy();
            this.signs.delete(sign.id); // before the sheet gate, or the retire sweep double-destroys it
          }
          const sheet = sheetFor(gfx, player);
          if (sheet === undefined) continue;
          const frame = sheet.frameByKind.construction;
          const node = new Sprite(gfx.textures.get(sheet.source, frame));
          // The frame's authored draw offset, applied via pivot so `position` stays the door point.
          node.pivot.set(-frame.offsetX, -frame.offsetY);
          this.container.addChild(node);
          entry = { node, player };
          this.signs.set(sign.id, entry);
        }
        entry.node.visible = true;
        entry.node.position.set(
          p.x + (sign.dx ?? 0),
          p.y + (sign.dy ?? 0) - terrainLiftAt(elevation, tileX, tileY),
        );
        this.drawn.add(sign.id);
      }
    }
    retireUndrawn(this.signs, this.drawn, (entry) => entry.node.destroy());
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.signs.clear();
  }
}
