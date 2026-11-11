import { type BuildingFootprint, type FootprintCell, footprintCellDx } from '@open-northland/data';
import type { GhostPlot } from '@open-northland/render';

/** The ground a held building takes at an anchor node, for the plot under its ghost, with the ground
 *  its later levels grow onto; undefined for a type whose footprint blocks nothing. */
export type GhostPlotAt = (typeId: number, tribe: number, col: number, row: number) => GhostPlot | undefined;

/**
 * {@link GhostPlotAt} over the content's footprints: the body cells, the level chain's largest body
 * where it outgrows them, and the door point, translated onto the hovered anchor. The last answer is
 * kept, so a cursor resting on a node hands the renderer the same plot each frame.
 */
export function makeGhostPlotAt(
  footprintOf: (typeId: number, tribe: number) => BuildingFootprint | undefined,
): GhostPlotAt {
  let last: { key: string; plot: GhostPlot | undefined } | null = null;
  return (typeId, tribe, col, row) => {
    const key = `${typeId}:${tribe}:${col},${row}`;
    if (last?.key === key) return last.plot;
    const footprint = footprintOf(typeId, tribe);
    const placed = (cells: readonly FootprintCell[]) =>
      cells.map((c) => ({ col: col + footprintCellDx(row, c), row: row + c.dy }));
    const plot =
      footprint === undefined || footprint.blocked.length === 0
        ? undefined
        : {
            cells: placed(footprint.blocked),
            ...(footprint.familyBody.length > footprint.blocked.length
              ? { grown: placed(footprint.familyBody) }
              : {}),
            ...(footprint.door === undefined
              ? {}
              : { door: { col: col + footprintCellDx(row, footprint.door), row: row + footprint.door.dy } }),
          };
    last = { key, plot };
    return plot;
  };
}
