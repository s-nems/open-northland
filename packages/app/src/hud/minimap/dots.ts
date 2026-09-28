import { fogTileVisible, ONE, tileToScreenX, tileToScreenY, type WorldBounds } from '@open-northland/render';
import type { FogView, WorldSnapshot } from '@open-northland/sim';
import { PLAYER_SWATCH_COLORS } from '../../catalog/roster.js';
import { actorsOf, isBuilding, isSettler, num, ownerPlayerOf } from '../../game/snapshot.js';

export interface MinimapFilters {
  readonly people: boolean;
  readonly buildings: boolean;
}

export const DEFAULT_MINIMAP_FILTERS: MinimapFilters = {
  people: true,
  buildings: true,
};

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
  filters: MinimapFilters = DEFAULT_MINIMAP_FILTERS,
): void {
  for (const e of actorsOf(snapshot)) {
    const player = ownerPlayerOf(e);
    if (player === undefined) continue; // wildlife and neutral buildings never plot
    const settler = isSettler(e);
    if ((settler && !filters.people) || (isBuilding(e) && !filters.buildings)) continue;
    const pos = e.components.Position as { x?: unknown; y?: unknown } | undefined;
    const x = num(pos?.x);
    const y = num(pos?.y);
    if (x === undefined || y === undefined) continue;
    const col = x / ONE;
    const row = y / ONE;
    // Only currently-visible ground plots; the viewer's own forces always see their own cell.
    if (fog !== null && !fogTileVisible(fog, col, row)) continue;
    const bx = (tileToScreenX(col, row) - bounds.minX) * scale;
    const by = (tileToScreenY(row) - bounds.minY) * scale;
    const half = settler ? SETTLER_DOT_PX / 2 : BUILDING_DOT_PX / 2;
    const colourSlot = playerColourOf?.(player) ?? player;
    const colour =
      PLAYER_SWATCH_COLORS[colourSlot % PLAYER_SWATCH_COLORS.length] ?? UNKNOWN_PLAYER_DOT_COLOUR;
    sink(bx, by, half, colour);
  }
}
