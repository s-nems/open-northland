import {
  type Camera,
  cameraViewport,
  type ElevationField,
  halfCellToScreen,
  TILE_HALF_H,
  TILE_HALF_W,
} from '@open-northland/render';
import { cellOfNode, FOG_STATE, type FogView, type WorldSnapshot } from '@open-northland/sim';
import { Container, Graphics } from 'pixi.js';
import type { MapOverlayControls } from '../../hud/map-overlays.js';
import {
  linkedPosts,
  type OverlayPost,
  overlayPostsWithin,
  postCovers,
  signpostOverlayIndex,
} from './signpost-model.js';

const NETWORK = 0x77e5cf;
const ISOLATED = 0xffc56b;

export function exploredOverlayNode(fog: FogView | null, hx: number, hy: number): boolean {
  if (fog === null) return true;
  const { cx, cy } = cellOfNode(hx, hy);
  return (
    cx >= 0 &&
    cy >= 0 &&
    cx < fog.cellsWide &&
    cy < fog.cellsHigh &&
    fog.stateAt(cx, cy) !== FOG_STATE.UNEXPLORED
  );
}

/** Reject coarse patches touching unknown ground, so zooming out cannot paint across the fog edge. */
export function exploredOverlayPatch(fog: FogView | null, hx: number, hy: number, step: number): boolean {
  if (fog === null || step === 1) return exploredOverlayNode(fog, hx, hy);
  for (let y = Math.ceil(hy - step / 2); y <= Math.floor(hy + step / 2); y++) {
    for (let x = Math.ceil(hx - step / 2); x <= Math.floor(hx + step / 2); x++) {
      if (!exploredOverlayNode(fog, x, y)) return false;
    }
  }
  return true;
}

export function overlayPatchPoints(
  hx: number,
  hy: number,
  step: number,
  mapSize: { width: number; height: number },
  point: (hx: number, hy: number) => { x: number; y: number },
): number[] {
  // Shared lifted corners keep neighbouring patches joined on slopes.
  const x0 = Math.max(0, hx - step / 2);
  const x1 = Math.min(mapSize.width * 2 - 1, hx + step / 2);
  const y0 = Math.max(0, hy - step / 2);
  const y1 = Math.min(mapSize.height * 2 - 1, hy + step / 2);
  const a = point(x0, y0);
  const b = point(x1, y0);
  const c = point(x1, y1);
  const d = point(x0, y1);
  return [a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y];
}

/** Connections are schematic straight lines between lifted endpoints; only fog splits a line. */
export function signpostLinkSegments(
  from: OverlayPost,
  to: OverlayPost,
  project: (hx: number, hy: number) => { x: number; y: number },
  fog: FogView | null,
): readonly (readonly [number, number, number, number])[] {
  const start = project(from.hx, from.hy);
  const end = project(to.hx, to.hy);
  const count = Math.max(1, Math.abs(to.hx - from.hx), Math.abs(to.hy - from.hy));
  const segments: [number, number, number, number][] = [];
  let first: number | null = null;
  for (let i = 0; i <= count + 1; i++) {
    const t = i / count;
    const visible =
      i <= count &&
      exploredOverlayNode(
        fog,
        Math.round(from.hx + (to.hx - from.hx) * t),
        Math.round(from.hy + (to.hy - from.hy) * t),
      );
    if (visible && first === null) first = i;
    if (!visible && first !== null) {
      if (i - 1 > first) {
        const a = first / count;
        const b = (i - 1) / count;
        segments.push([
          start.x + (end.x - start.x) * a,
          start.y + (end.y - start.y) * a,
          start.x + (end.x - start.x) * b,
          start.y + (end.y - start.y) * b,
        ]);
      }
      first = null;
    }
  }
  return segments;
}

export interface SignpostMapOverlay {
  update(
    snapshot: WorldSnapshot,
    camera: Camera,
    screen: { width: number; height: number },
    player: number | null,
    fog: FogView | null,
  ): void;
  dispose(): void;
}

/** Authored visualization of the current simulation: union of civilian guide ranges, explicit stored
 *  links, and isolated posts. The shaded range does not promise a walkable route through obstacles. */
export function createSignpostMapOverlay(
  parent: Container,
  state: MapOverlayControls,
  mapSize: { width: number; height: number },
  elevation?: ElevationField,
): SignpostMapOverlay {
  const root = new Container();
  root.zIndex = 890;
  root.eventMode = 'none';
  const field = new Graphics();
  const linkHalo = new Graphics();
  const links = new Graphics();
  const markers = new Graphics();
  const connectionPaths = [linkHalo, links];
  root.addChild(field, linkHalo, links, markers);
  parent.addChild(root);
  let lastIndex: ReturnType<typeof signpostOverlayIndex> | null = null;
  let lastKey = '';
  const point = (hx: number, hy: number) => {
    const p = halfCellToScreen(hx, hy);
    return { x: p.x, y: p.y - (elevation?.liftAtNode(hx, hy) ?? 0) };
  };
  return {
    update(snapshot, camera, screen, player, fog) {
      root.visible = state.active === 'signposts' && player !== null;
      if (!root.visible || player === null) return;
      const index = signpostOverlayIndex(snapshot);
      const zoom = camera.scale ?? 1;
      const key = `${index.revision}:${player}:${fog?.player}:${fog?.generation}:${camera.offsetX}:${camera.offsetY}:${zoom}:${screen.width}:${screen.height}`;
      if (lastIndex === index && lastKey === key) return;
      lastIndex = index;
      lastKey = key;
      root.position.set(camera.offsetX, camera.offsetY);
      root.scale.set(zoom);
      field.clear();
      linkHalo.clear();
      links.clear();
      markers.clear();
      const vp = cameraViewport(camera, screen.width, screen.height, (elevation?.maxLift ?? 0) + 40);
      const bounds = {
        minX: Math.max(0, Math.floor(vp.minX / TILE_HALF_W)),
        maxX: Math.min(mapSize.width * 2 - 1, Math.ceil(vp.maxX / TILE_HALF_W)),
        minY: Math.max(0, Math.floor(vp.minY / (TILE_HALF_H / 2))),
        maxY: Math.min(mapSize.height * 2 - 1, Math.ceil(vp.maxY / (TILE_HALF_H / 2))),
      };
      const posts = overlayPostsWithin(index, player, bounds);
      // At distant zooms each sample remains at least eight screen px high. Sampling is visual only;
      // the range predicate and links remain those of the sim. Native zoom samples every half-cell.
      const step = Math.max(1, Math.ceil(8 / ((TILE_HALF_H / 2) * zoom)));
      const covered = (hx: number, hy: number): boolean =>
        hx >= 0 &&
        hy >= 0 &&
        hx < mapSize.width * 2 &&
        hy < mapSize.height * 2 &&
        exploredOverlayNode(fog, hx, hy) &&
        posts.some((post) => postCovers(post, hx, hy));
      for (let hy = Math.floor(bounds.minY / step) * step; hy <= bounds.maxY; hy += step) {
        for (let hx = Math.floor(bounds.minX / step) * step; hx <= bounds.maxX; hx += step) {
          if (!covered(hx, hy) || !exploredOverlayPatch(fog, hx, hy, step)) continue;
          field.poly(overlayPatchPoints(hx, hy, step, mapSize, point));
        }
      }
      field.fill({ color: NETWORK, alpha: 0.16 });
      for (const post of posts) {
        const neighbours = linkedPosts(index, post);
        const start = point(post.hx, post.hy);
        for (const other of neighbours) {
          if (post.id >= other.id) continue;
          for (const [x0, y0, x1, y1] of signpostLinkSegments(post, other, point, fog)) {
            for (const line of connectionPaths) line.moveTo(x0, y0).lineTo(x1, y1);
          }
        }
        if (!exploredOverlayNode(fog, post.hx, post.hy)) continue;
        const color = neighbours.length === 0 ? ISOLATED : NETWORK;
        const radius = 7 / zoom;
        markers
          .circle(start.x, start.y, radius)
          .fill({ color: 0x102624, alpha: 0.9 })
          .stroke({ color, width: 2 / zoom });
        if (neighbours.length > 0) markers.circle(start.x, start.y, 2.5 / zoom).fill(color);
      }
      linkHalo.stroke({ color: 0x102624, width: 5 / zoom, alpha: 0.85 });
      links.stroke({ color: NETWORK, width: 2 / zoom, alpha: 0.95 });
    },
    dispose: () => root.destroy({ children: true }),
  };
}
