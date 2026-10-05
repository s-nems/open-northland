import {
  type Camera,
  cameraViewport,
  type ElevationField,
  halfCellToScreen,
  TILE_HALF_H,
  TILE_HALF_W,
} from '@open-northland/render';
import {
  linkedPosts,
  type OverlayPost,
  overlayPostsWithin,
  signpostOverlayIndex,
} from '@open-northland/render/data';
import {
  cellOfNode,
  FOG_STATE,
  type FogView,
  reachContains,
  type SignpostReachView,
  type WorldSnapshot,
} from '@open-northland/sim';
import { Container, Graphics } from 'pixi.js';
import type { MapOverlayControls } from '../../hud/map-overlays.js';

const NETWORK_COLOURS = [0x72c7ec, 0xe9b967, 0xb5a0ed, 0x9dc97a, 0xe898a8, 0x72d7c1];
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

/** Goods-search areas come from the sim; colour and borders distinguish disconnected networks. */
export function createSignpostMapOverlay(
  parent: Container,
  state: MapOverlayControls,
  mapSize: { width: number; height: number },
  elevation?: ElevationField,
  reachFor?: (player: number) => SignpostReachView | null,
  selectedIds: () => readonly number[] = () => [],
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
  let lastReach: SignpostReachView | null = null;
  let indexedReach: SignpostReachView | null = null;
  const reachPosts = new Map<number, NonNullable<SignpostReachView>['posts'][number]>();
  const colours = new Map<number, number>();
  const point = (hx: number, hy: number) => {
    const p = halfCellToScreen(hx, hy);
    return { x: p.x, y: p.y - (elevation?.liftAtNode(hx, hy) ?? 0) };
  };
  return {
    update(snapshot, camera, screen, player, fog) {
      root.visible = state.active === 'signposts' && player !== null;
      if (!root.visible || player === null) return;
      const index = signpostOverlayIndex(snapshot);
      const reach = reachFor?.(player) ?? null;
      if (indexedReach !== reach) {
        indexedReach = reach;
        reachPosts.clear();
        colours.clear();
        for (const p of reach?.posts ?? []) reachPosts.set(p.id, p);
        const groups = [...new Set(reach?.posts.map((p) => p.group) ?? [])].sort((a, b) => a - b);
        groups.forEach((group, i) => {
          colours.set(group, NETWORK_COLOURS[i % NETWORK_COLOURS.length] ?? ISOLATED);
        });
      }
      const selected = selectedIds();
      const selectedGroup = selected
        .map((id) => reachPosts.get(id)?.group)
        .find((group) => group !== undefined);
      const zoom = camera.scale ?? 1;
      root.position.set(camera.offsetX, camera.offsetY);
      root.scale.set(zoom);
      const vp = cameraViewport(camera, screen.width, screen.height, (elevation?.maxLift ?? 0) + 40);
      // Retain a padded, world-aligned drawing through small camera moves.
      const block = 16;
      const bounds = {
        minX: Math.max(0, (Math.floor(vp.minX / TILE_HALF_W / block) - 1) * block),
        maxX: Math.min(mapSize.width * 2 - 1, (Math.ceil(vp.maxX / TILE_HALF_W / block) + 1) * block),
        minY: Math.max(0, (Math.floor(vp.minY / (TILE_HALF_H / 2) / block) - 1) * block),
        maxY: Math.min(mapSize.height * 2 - 1, (Math.ceil(vp.maxY / (TILE_HALF_H / 2) / block) + 1) * block),
      };
      const key = `${selected.join(',')}:${index.revision}:${player}:${fog?.player}:${fog?.generation}:${bounds.minX}:${bounds.maxX}:${bounds.minY}:${bounds.maxY}:${zoom}`;
      if (lastIndex === index && lastKey === key && lastReach === reach) return;
      lastReach = reach;
      lastIndex = index;
      lastKey = key;
      field.clear();
      linkHalo.clear();
      links.clear();
      markers.clear();
      // At distant zooms each sample remains at least eight screen px high. Sampling is visual only;
      // the range predicate and links remain those of the sim. Native zoom samples every half-cell.
      const step = Math.max(1, Math.ceil(8 / ((TILE_HALF_H / 2) * zoom)));
      // Border neighbours may lie beyond the retained drawing. Include their contributing posts too.
      const posts = overlayPostsWithin(index, player, {
        minX: bounds.minX - 2 * step,
        maxX: bounds.maxX + 2 * step,
        minY: bounds.minY - 2 * step,
        maxY: bounds.maxY + 2 * step,
      });
      const groups = new Map<number, NonNullable<typeof reach>['posts'][number][]>();
      for (const visible of posts) {
        const post = reachPosts.get(visible.id);
        if (post === undefined) continue;
        const group = groups.get(post.group);
        if (group === undefined) groups.set(post.group, [post]);
        else group.push(post);
      }
      const colorOf = (group: number): number => colours.get(group) ?? ISOLATED;
      for (const [group, members] of groups) {
        const color = colorOf(group);
        const muted = selectedGroup !== undefined && selectedGroup !== group;
        const covered = (hx: number, hy: number): boolean =>
          exploredOverlayNode(fog, hx, hy) && members.some((p) => reachContains(p.area, hx, hy));
        const patches: { hx: number; hy: number; points: number[] }[] = [];
        const patchCoverage = new Map<number, boolean>();
        const hasPatch = (hx: number, hy: number): boolean => {
          if (hx < 0 || hy < 0 || hx >= mapSize.width * 2 || hy >= mapSize.height * 2) return false;
          const key = hy * mapSize.width * 2 + hx;
          const held = patchCoverage.get(key);
          if (held !== undefined) return held;
          let complete = covered(hx, hy) && exploredOverlayPatch(fog, hx, hy, step);
          for (let y = Math.ceil(hy - step / 2); y <= Math.floor(hy + step / 2) && complete; y++)
            for (let x = Math.ceil(hx - step / 2); x <= Math.floor(hx + step / 2); x++)
              if (!covered(x, y)) {
                complete = false;
                break;
              }
          patchCoverage.set(key, complete);
          return complete;
        };
        for (let hy = Math.floor(bounds.minY / step) * step; hy <= bounds.maxY; hy += step) {
          for (let hx = Math.floor(bounds.minX / step) * step; hx <= bounds.maxX; hx += step) {
            if (!hasPatch(hx, hy)) continue;
            const points = overlayPatchPoints(hx, hy, step, mapSize, point);
            patches.push({ hx, hy, points });
            field.poly(points);
          }
        }
        field.fill({ color, alpha: muted ? 0.035 : 0.13 });
        for (const { hx, hy, points } of patches) {
          const neighbours = [
            [0, -step],
            [step, 0],
            [0, step],
            [-step, 0],
          ];
          neighbours.forEach(([dx = 0, dy = 0], edge) => {
            if (hasPatch(hx + dx, hy + dy)) return;
            const next = (edge + 1) % 4;
            field
              .moveTo(points[edge * 2] ?? 0, points[edge * 2 + 1] ?? 0)
              .lineTo(points[next * 2] ?? 0, points[next * 2 + 1] ?? 0);
          });
        }
        field.stroke({ color, alpha: muted ? 0.18 : 0.65, width: 1 / zoom });
      }
      for (const post of posts) {
        const neighbours = linkedPosts(index, post);
        const group = reachPosts.get(post.id)?.group ?? post.id;
        const color = colorOf(group);
        const muted = selectedGroup !== undefined && selectedGroup !== group;
        const start = point(post.hx, post.hy);
        for (const other of neighbours) {
          if (post.id >= other.id) continue;
          for (const [x0, y0, x1, y1] of signpostLinkSegments(post, other, point, fog)) {
            for (const line of connectionPaths) line.moveTo(x0, y0).lineTo(x1, y1);
          }
        }
        if (!exploredOverlayNode(fog, post.hx, post.hy)) continue;
        linkHalo.stroke({ color: 0x102624, width: 5 / zoom, alpha: muted ? 0.3 : 0.85 });
        links.stroke({ color, width: 2 / zoom, alpha: muted ? 0.25 : 0.95 });
        const radius = (selected.includes(post.id) ? 10 : 7) / zoom;
        markers
          .circle(start.x, start.y, radius)
          .fill({ color: 0x102624, alpha: 0.9 })
          .stroke({ color, width: 2 / zoom });
        if (neighbours.length > 0) markers.circle(start.x, start.y, 2.5 / zoom).fill(color);
      }
    },
    dispose: () => root.destroy({ children: true }),
  };
}
