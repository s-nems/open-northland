import { FOG_STATE, type FogView } from '@vinland/sim';

/**
 * Render-side fog-of-war helpers — the thin data layer between the sim's {@link FogView} (per-cell
 * tri-state mask for the viewer player, `Simulation.fogView`) and the GPU consumers (the fog wash,
 * the sprite cull, the tall map-object gate). Pure math, no Pixi — headlessly unit-testable like the
 * rest of `render`'s data layer. Floats are fine here (render never feeds the sim).
 */

/**
 * The visual CELL containing a fractional tile position — the render twin of the sim's
 * `cellOfNode(nodeOfPosition(p))` (halfcell.ts: `hx = ⌊(x + stagger(y))·2⌋`, cell = `hx>>1` =
 * `⌊x + stagger(y)⌋`; `cy = ⌊y⌋`). The stagger is the same triangle wave `tileToScreen` interpolates
 * (0 at even rows, ½ cell at odd, linear between), so a walking entity resolves to the SAME cell the
 * sim's vision mask stamped — the two sides can't disagree about which cell hides a unit.
 */
export function fogCellOfTile(tileX: number, tileY: number): { cx: number; cy: number } {
  const cycle = ((tileY % 2) + 2) % 2; // row's place in the 2-row stagger cycle, robust to negatives
  const stagger = (1 - Math.abs(1 - cycle)) / 2; // 0 at even rows, ½ at odd, linear between
  return { cx: Math.floor(tileX + stagger), cy: Math.floor(tileY) };
}

/**
 * Whether a fractional tile position is fully VISIBLE to the fog view's player — the per-entity cull
 * predicate the sprite pool applies (an entity in an unexplored/explored-only cell is not drawn;
 * user decision 2026-07-11: the grey layer shows terrain only, no entities/resources).
 */
export function fogTileVisible(view: FogView, tileX: number, tileY: number): boolean {
  const { cx, cy } = fogCellOfTile(tileX, tileY);
  return view.stateAt(cx, cy) === FOG_STATE.VISIBLE;
}
