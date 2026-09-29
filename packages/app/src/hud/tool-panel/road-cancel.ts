import { type LineNode, type LinePreviewNode, screenLine, straightLine } from './line-tool.js';

export interface RoadCancelSpec {
  readonly maxEdges: number;
  /** The seat's own road site on a node, or null. */
  readonly siteAt: (col: number, row: number) => number | null;
  /** Withdraws the sites a finished line crossed; never called with none. */
  readonly cancel: (sites: readonly number[]) => void;
}

/**
 * The road tool's cancel line, drawn with Alt held: a click starts it, or it picks up the road line
 * already started, and the next click withdraws the seat's road sites on its nodes. It runs straight over
 * whatever lies between, since nothing on the ground refuses a cancel.
 */
export interface RoadCancelLine {
  anchor(): LineNode | null;
  /** The line from `from` to `tile`: `open` where a site goes, `built` where the line only passes. */
  preview(from: LineNode, tile: LineNode, straight: boolean): LinePreviewNode[];
  /** Starts the line when `from` is null, else withdraws the sites under it; false when it withdrew none. */
  click(from: LineNode | null, tile: LineNode, straight: boolean): boolean;
  stepBack(): boolean;
}

export function createRoadCancelLine(spec: RoadCancelSpec): RoadCancelLine {
  let anchor: LineNode | null = null;
  const nodesOf = (from: LineNode, tile: LineNode, straight: boolean): LineNode[] =>
    straight ? straightLine(from, tile, spec.maxEdges) : screenLine(from, tile, spec.maxEdges);
  return {
    anchor: () => anchor,
    preview: (from, tile, straight) =>
      nodesOf(from, tile, straight).map(({ col, row }) => ({
        col,
        row,
        state: spec.siteAt(col, row) === null ? 'built' : 'open',
      })),
    click: (from, tile, straight): boolean => {
      if (from === null) {
        anchor = { col: tile.col, row: tile.row };
        return true;
      }
      anchor = null;
      const sites: number[] = [];
      for (const node of nodesOf(from, tile, straight)) {
        const site = spec.siteAt(node.col, node.row);
        if (site !== null) sites.push(site);
      }
      if (sites.length === 0) return false;
      spec.cancel(sites);
      return true;
    },
    stepBack: (): boolean => {
      if (anchor === null) return false;
      anchor = null;
      return true;
    },
  };
}
