import { fogTileVisible, ONE, tileToScreen } from '@open-northland/render';
import type { FogView, WorldSnapshot } from '@open-northland/sim';
import { PLAYER_SWATCH_COLORS } from '../../catalog/roster.js';
import { isBuilding, isSettler, ownerPlayerOf, positionOf } from '../../game/snapshot.js';
import type { WorldBounds } from './model.js';

/** Dot half-extents in minimap px: a settler is a 2×2 dot, a building a 3×3 block. */
const SETTLER_DOT_PX = 2;
const BUILDING_DOT_PX = 3;
/** Dot colour for a player outside the swatch table — unreachable today (the index is taken modulo
 *  the table length); a named value so retuning the view rect never silently retunes stray dots. */
const UNKNOWN_PLAYER_DOT_COLOUR = 0xffffff;

/** A plotted dot: raster-px centre `(bx, by)`, half-extent `half`, packed `0xRRGGBB` `colour`. Passed
 *  as loose primitives, never a per-dot object, so the sink adds no per-dot allocation of its own and
 *  the caller stamps straight into its retained buffer (see `stampDot`). */
export type MinimapDotSink = (bx: number, by: number, half: number, colour: number) => void;

/**
 * Project every owned settler and building in `snapshot` to a dot for the minimap, handing each to
 * `sink` in the ground raster's px (1:1 with the map picture: `scale` minimap-px per world-px, offset
 * by `bounds`) and coloured by owning player.
 */
export function forEachMinimapDot(
  snapshot: WorldSnapshot,
  fog: FogView | null,
  bounds: WorldBounds,
  scale: number,
  playerColourOf: ((player: number) => number) | undefined,
  sink: MinimapDotSink,
): void {
  for (const e of snapshot.entities) {
    const player = ownerPlayerOf(e);
    if (player === undefined) continue; // neutral (piles, projectiles…) — the minimap shows forces
    const settler = isSettler(e);
    if (!settler && !isBuilding(e)) continue;
    const pos = positionOf(e);
    if (pos === undefined) continue;
    // Fog: a dot only on currently-visible ground (the viewer's own forces always are — they see
    // their own cell; an enemy in unexplored/grey ground stays off the minimap).
    if (fog !== null && !fogTileVisible(fog, pos.x / ONE, pos.y / ONE)) continue;
    const s = tileToScreen(pos.x / ONE, pos.y / ONE);
    // Raster px coords — the buffer is 1:1 with the map picture's logical px.
    const bx = (s.x - bounds.minX) * scale;
    const by = (s.y - bounds.minY) * scale;
    const half = settler ? SETTLER_DOT_PX / 2 : BUILDING_DOT_PX / 2;
    const colourSlot = playerColourOf?.(player) ?? player;
    const colour =
      PLAYER_SWATCH_COLORS[colourSlot % PLAYER_SWATCH_COLORS.length] ?? UNKNOWN_PLAYER_DOT_COLOUR;
    sink(bx, by, half, colour);
  }
}
