import { fogTileVisible, ONE, tileToScreen, type WorldBounds } from '@open-northland/render';
import type { FogView, WorldSnapshot } from '@open-northland/sim';
import { PLAYER_SWATCH_COLORS } from '../../catalog/roster.js';
import { actorsOf, isSettler, ownerPlayerOf, positionOf } from '../../game/snapshot.js';

/** Dot sizes in minimap px: a settler is a 2x2 dot, a building a 3x3 block. */
const SETTLER_DOT_PX = 2;
const BUILDING_DOT_PX = 3;
/** Fallback dot colour for a player outside the swatch table. */
const UNKNOWN_PLAYER_DOT_COLOUR = 0xffffff;

/** A plotted dot: raster-px centre `(bx, by)`, half-extent `half`, packed `0xRRGGBB` `colour`. Loose
 *  primitives keep the sink itself free of allocation. */
export type MinimapDotSink = (bx: number, by: number, half: number, colour: number) => void;

/**
 * Project every owned settler and building in `snapshot` to a minimap dot, in the ground raster's px
 * (`scale` minimap-px per world-px, offset by `bounds`) and coloured by owning player.
 */
export function forEachMinimapDot(
  snapshot: WorldSnapshot,
  fog: FogView | null,
  bounds: WorldBounds,
  scale: number,
  playerColourOf: ((player: number) => number) | undefined,
  sink: MinimapDotSink,
): void {
  for (const e of actorsOf(snapshot)) {
    const player = ownerPlayerOf(e);
    if (player === undefined) continue; // wildlife and neutral buildings never plot
    const settler = isSettler(e);
    const pos = positionOf(e);
    if (pos === undefined) continue;
    // Only currently-visible ground plots; the viewer's own forces always see their own cell.
    if (fog !== null && !fogTileVisible(fog, pos.x / ONE, pos.y / ONE)) continue;
    const s = tileToScreen(pos.x / ONE, pos.y / ONE);
    const bx = (s.x - bounds.minX) * scale;
    const by = (s.y - bounds.minY) * scale;
    const half = settler ? SETTLER_DOT_PX / 2 : BUILDING_DOT_PX / 2;
    const colourSlot = playerColourOf?.(player) ?? player;
    const colour =
      PLAYER_SWATCH_COLORS[colourSlot % PLAYER_SWATCH_COLORS.length] ?? UNKNOWN_PLAYER_DOT_COLOUR;
    sink(bx, by, half, colour);
  }
}
