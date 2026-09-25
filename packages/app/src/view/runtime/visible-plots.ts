import type { ConstructionPlot, FogView } from '@open-northland/sim';

/**
 * The construction plots the viewer may see. The plot layer draws above the fog wash, so an enemy
 * foundation in the black would paint through it. The sim keeps its list until a site changes and the
 * mask moves with its generation and its seat, so the filter reruns on any of those changes and an
 * unchanged frame hands the renderer the same array.
 */
export function createVisiblePlots(
  plots: () => readonly ConstructionPlot[],
  seesNode: (hx: number, hy: number) => boolean,
): (fogView: Pick<FogView, 'generation' | 'player'> | null) => readonly ConstructionPlot[] {
  let seen: {
    readonly source: readonly ConstructionPlot[];
    readonly fogGeneration: number;
    readonly fogPlayer: number;
    readonly visible: readonly ConstructionPlot[];
  } | null = null;
  return (fogView) => {
    const source = plots();
    if (fogView === null) return source;
    if (
      seen?.source === source &&
      seen.fogGeneration === fogView.generation &&
      seen.fogPlayer === fogView.player
    ) {
      return seen.visible;
    }
    // Plot cells are half-cell nodes.
    const visible = source
      .map((p) => ({ cells: p.cells.filter((c) => seesNode(c.col, c.row)) }))
      .filter((p) => p.cells.length > 0);
    seen = { source, fogGeneration: fogView.generation, fogPlayer: fogView.player, visible };
    return visible;
  };
}
