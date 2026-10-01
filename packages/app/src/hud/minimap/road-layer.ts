import { TILE_HALF_H, TILE_HALF_W, type WorldBounds } from '@open-northland/render';
import { roadRevisionOf, roadShardOf } from '@open-northland/render/data';
import { entitiesWith, FOG_STATE, type FogMode, type FogView, type WorldSnapshot } from '@open-northland/sim';
import { BufferImageSource, type Container, Sprite, Texture } from 'pixi.js';
import type { Rect } from '../geometry.js';
import { type DotRaster, stampMark } from './stamps.js';

/** Laid roads are ground, drawn as a faint earth line. */
export const ROAD_DOT_COLOUR = 0xd2bf8f;

/** No revision a snapshot reports, so the first draw collects the network. */
const UNCOLLECTED = -1;

/** `cellOfNode`'s four-row lattice cycle: a node row's phase nudges its column before halving. */
const LATTICE_PHASE_MASK = 3;
const PHASE_BELOW_EVEN_ROW = 1;
const PHASE_ODD_ANCHOR_ROW = 2;

/** The fog cell column of node `(hx, hy)` by `cellOfNode`'s rule, inline so the bake allocates nothing
 *  per node; a test holds the two equal. The cell row is `hy >> 1`. */
export function fogCellXOfNode(hx: number, hy: number): number {
  const phase = hy & LATTICE_PHASE_MASK;
  const nudge = phase === PHASE_BELOW_EVEN_ROW ? 1 : phase === PHASE_ODD_ANCHOR_ROW ? -1 : 0;
  return (hx + nudge) >> 1;
}

export interface RoadLayerGeometry {
  readonly bounds: WorldBounds;
  /** Raster px per projected world px. */
  readonly scale: number;
  /** The map's width in half-cell nodes, the stride of a road shard's node ids. */
  readonly nodeWidth: number;
}

/**
 * The laid roads as a retained raster in the dot raster's px. A road shows wherever the ground does,
 * explored or visible, so only the road network, the viewer seat, the fog mode and the stamp size
 * redraw the whole raster. Explored ground only grows under one mode, so a fog change re-reads just the
 * nodes still hidden. Answers whether `raster` changed.
 */
export function createRoadRaster(
  raster: DotRaster,
  geometry: RoadLayerGeometry,
): (snapshot: WorldSnapshot, fog: FogView | null, pxPerMinimapPx: number) => boolean {
  const { bounds, scale, nodeWidth } = geometry;
  let revision = UNCOLLECTED;
  let player: number | null = null;
  let mode: FogMode | null = null;
  let stampScale = 0;
  let generation = 0;
  // Per laid node, collected once per network change: its raster px centre and fog cell.
  let count = 0;
  let pxX = new Float64Array(0);
  let pxY = new Float64Array(0);
  let cellX = new Int32Array(0);
  let cellY = new Int32Array(0);
  // Indexes into the node lanes of the nodes on unexplored ground at the last draw.
  let hidden = new Int32Array(0);
  let hiddenCount = 0;

  const collect = (snapshot: WorldSnapshot): void => {
    const shards = entitiesWith(snapshot, 'RoadShard');
    let total = 0;
    for (const carrier of shards) total += roadShardOf(carrier)?.nodes.length ?? 0;
    if (total > pxX.length) {
      pxX = new Float64Array(total);
      pxY = new Float64Array(total);
      cellX = new Int32Array(total);
      cellY = new Int32Array(total);
      hidden = new Int32Array(total);
    }
    count = 0;
    for (const carrier of shards) {
      const nodes = roadShardOf(carrier)?.nodes;
      if (nodes === undefined) continue;
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i] ?? 0;
        const hx = node % nodeWidth;
        const hy = (node - hx) / nodeWidth;
        pxX[count] = (hx * TILE_HALF_W - bounds.minX) * scale;
        pxY[count] = ((hy * TILE_HALF_H) / 2 - bounds.minY) * scale;
        cellX[count] = fogCellXOfNode(hx, hy);
        cellY[count] = hy >> 1;
        count++;
      }
    }
  };
  const stamp = (i: number): void =>
    stampMark(raster, pxX[i] ?? 0, pxY[i] ?? 0, 'road', ROAD_DOT_COLOUR, stampScale);
  const unexplored = (fog: FogView, i: number): boolean =>
    fog.stateAt(cellX[i] ?? 0, cellY[i] ?? 0) === FOG_STATE.UNEXPLORED;

  return (snapshot, fog, pxPerMinimapPx) => {
    const nextRevision = roadRevisionOf(snapshot);
    const nextPlayer = fog?.player ?? null;
    const nextMode = fog?.mode ?? null;
    if (nextRevision !== revision) collect(snapshot);
    if (
      nextRevision !== revision ||
      nextPlayer !== player ||
      nextMode !== mode ||
      pxPerMinimapPx !== stampScale
    ) {
      revision = nextRevision;
      player = nextPlayer;
      mode = nextMode;
      stampScale = pxPerMinimapPx;
      generation = fog?.generation ?? 0;
      raster.rgba.fill(0);
      hiddenCount = 0;
      for (let i = 0; i < count; i++) {
        if (fog !== null && unexplored(fog, i)) hidden[hiddenCount++] = i;
        else stamp(i);
      }
      return true;
    }
    if (fog === null || fog.generation === generation || hiddenCount === 0) return false;
    generation = fog.generation;
    let kept = 0;
    for (let k = 0; k < hiddenCount; k++) {
      const i = hidden[k] ?? 0;
      if (unexplored(fog, i)) hidden[kept++] = i;
      else stamp(i);
    }
    const changed = kept !== hiddenCount;
    hiddenCount = kept;
    return changed;
  };
}

export interface MinimapRoadLayer {
  /** Show the laid roads for `fog`'s viewer, stamped at `pxPerMinimapPx`, or hide them. */
  draw(snapshot: WorldSnapshot, fog: FogView | null, shown: boolean, pxPerMinimapPx: number): void;
  dispose(): void;
}

/** {@link createRoadRaster} on a sprite over `map`, parented on creation: create it under the dots. */
export function createRoadLayer(
  container: Container,
  map: Rect,
  geometry: RoadLayerGeometry,
): MinimapRoadLayer {
  const width = Math.max(1, Math.round(map.w));
  const height = Math.max(1, Math.round(map.h));
  const rgba = new Uint8Array(width * height * 4);
  const texture = new Texture({
    source: new BufferImageSource({ resource: rgba, width, height, scaleMode: 'nearest' }),
  });
  const sprite = new Sprite(texture);
  sprite.position.set(map.x, map.y);
  sprite.width = map.w;
  sprite.height = map.h;
  container.addChild(sprite);
  const redraw = createRoadRaster({ rgba, width, height }, geometry);
  return {
    draw: (snapshot, fog, shown, pxPerMinimapPx) => {
      sprite.visible = shown;
      if (shown && redraw(snapshot, fog, pxPerMinimapPx)) texture.source.update();
    },
    dispose: () => {
      sprite.destroy();
      texture.destroy(true);
    },
  };
}
