import { linkedPosts, overlayPostsWithin, signpostOverlayIndex } from '@open-northland/render/data';
import {
  components,
  FOG_MODE,
  FOG_STATE,
  type FogView,
  positionOfNode,
  SnapshotMirror,
} from '@open-northland/sim';
import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { createSceneSim, getScene } from '../src/scenes/index.js';
import {
  createSignpostMapOverlay,
  exploredOverlayNode,
  exploredOverlayPatch,
  overlayPatchPoints,
  signpostLinkSegments,
} from '../src/view/map-overlays/signposts.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

function post(id: number, hx: number, hy: number, links: number[] = [], player = 0): Ent {
  return { id, components: { Position: positionOfNode(hx, hy), Owner: { player }, Signpost: { links } } };
}

const VIEW = { minX: 0, minY: 0, maxX: 10, maxY: 20 };

describe('signpost map overlay', () => {
  it('includes coverage from off-screen posts, excludes other owners and distant posts, and uses stored links', () => {
    const index = signpostOverlayIndex(
      snapshotOf([
        post(1, 0, 10, [2, 4, 99]),
        post(2, 35, 10, [1]),
        post(3, 45, 10),
        post(4, 4, 4, [], 1),
        post(5, 500, 500),
      ]),
    );
    const posts = overlayPostsWithin(index, 0, VIEW);
    expect(posts.map((p) => p.id).sort()).toEqual([1, 2, 3]);
    const first = posts.find((p) => p.id === 1);
    const isolated = posts.find((p) => p.id === 3);
    if (first === undefined || isolated === undefined) throw new Error('missing fixture post');
    expect(linkedPosts(index, first).map((p) => p.id)).toEqual([2]);
    expect(linkedPosts(index, isolated)).toEqual([]);
  });

  it('keeps its index through ordinary ticks and follows relocation, ownership, links and removal through deltas', () => {
    const scene = getScene('signposts');
    if (scene === undefined) throw new Error('missing scene');
    const sim = createSceneSim(scene);
    const deltas = sim.snapshotDeltas();
    const mirror = new SnapshotMirror();
    const advance = () => {
      const delta = deltas.next();
      if (delta !== null) mirror.apply(delta);
      return signpostOverlayIndex(mirror.snapshot());
    };
    const index = advance();
    const revision = index.revision;
    sim.step();
    expect(advance()).toBe(index);
    expect(index.revision).toBe(revision);
    const entity = sim.world.query(components.Signpost).next().value;
    if (entity === undefined) throw new Error('missing signpost');
    sim.world.add(entity, components.Position, positionOfNode(200, 20));
    sim.world.add(entity, components.Owner, { player: 7 });
    sim.world.add(entity, components.Signpost, { links: [] });
    advance();
    expect(index.posts.get(entity)).toEqual({ id: entity, hx: 200, hy: 20, player: 7, links: [] });
    expect(
      overlayPostsWithin(index, 7, { minX: 195, minY: 20, maxX: 205, maxY: 20 }).map((p) => p.id),
    ).toContain(entity);
    expect(mirror.verifyIndexes()).toEqual([]);
    sim.world.destroy(entity);
    advance();
    expect(index.posts.has(entity)).toBe(false);
    expect(mirror.verifyIndexes()).toEqual([]);
  });

  it('clips unknown ground and map edges while keeping explored terrain', () => {
    const fog: FogView = {
      player: 0,
      mode: FOG_MODE.CLASSIC_FOG_OF_WAR,
      generation: 1,
      cellsWide: 20,
      cellsHigh: 20,
      stateAt: (cx) => (cx < 5 ? FOG_STATE.EXPLORED : FOG_STATE.UNEXPLORED),
    };
    expect(exploredOverlayNode(fog, 4, 4)).toBe(true);
    expect(exploredOverlayNode(fog, 14, 4)).toBe(false);
    expect(exploredOverlayNode(fog, -2, 4)).toBe(false);
    expect(exploredOverlayNode(fog, 4, 80)).toBe(false);
  });

  it('joins coverage patches along a slope and rejects zoomed patches spilling onto unknown ground', () => {
    const point = (hx: number, hy: number) => ({ x: hx * 34, y: hy * 19 - (200 - 5 * hy) });
    const above = overlayPatchPoints(20, 20, 1, { width: 100, height: 100 }, point);
    const below = overlayPatchPoints(20, 21, 1, { width: 100, height: 100 }, point);
    expect(above.slice(4, 6)).toEqual(below.slice(2, 4));
    expect(above.slice(6, 8)).toEqual(below.slice(0, 2));
    expect(above[5]).toBe(292);
    const fog: FogView = {
      player: 0,
      mode: FOG_MODE.CLASSIC_FOG_OF_WAR,
      generation: 1,
      cellsWide: 20,
      cellsHigh: 20,
      stateAt: (cx, cy) => (cx === 10 && cy === 10 ? FOG_STATE.EXPLORED : FOG_STATE.UNEXPLORED),
    };
    expect(exploredOverlayPatch(fog, 20, 20, 1)).toBe(true);
    expect(exploredOverlayPatch(fog, 20, 20, 5)).toBe(false);
    expect(exploredOverlayPatch(null, 20, 20, 5)).toBe(true);
  });

  it('draws one straight connection over hills and keeps fog gaps on that same line', () => {
    const index = signpostOverlayIndex(snapshotOf([post(1, 0, 0, [2]), post(2, 10, 0, [1])]));
    const from = index.posts.get(1);
    const to = index.posts.get(2);
    if (from === undefined || to === undefined) throw new Error('missing fixture posts');
    const sampled: number[] = [];
    const project = (hx: number, hy: number) => {
      sampled.push(hx);
      return { x: hx * 34, y: hy * 19 - (hx === 5 ? 100 : hx * 2) };
    };
    expect(signpostLinkSegments(from, to, project, null)).toEqual([[0, 0, 340, -20]]);
    expect(sampled).toEqual([0, 10]);
    const fog: FogView = {
      player: 0,
      mode: FOG_MODE.CLASSIC_FOG_OF_WAR,
      generation: 1,
      cellsWide: 20,
      cellsHigh: 20,
      stateAt: (cx) => (cx === 2 ? FOG_STATE.UNEXPLORED : FOG_STATE.EXPLORED),
    };
    expect(signpostLinkSegments(from, to, project, fog)).toEqual([
      [0, 0, 102, -6],
      [204, -12, 340, -20],
    ]);
  });

  it('toggles the retained drawing, follows seat changes, and removes its graphics on disposal', () => {
    const parent = new Container();
    const state: { active: 'signposts' | null } = { active: null };
    const overlay = createSignpostMapOverlay(parent, state, { width: 100, height: 100 });
    const snapshot = snapshotOf([post(1, 4, 4, [2]), post(2, 24, 4, [1]), post(3, 70, 4)]);
    const update = (player: number | null = 0) =>
      overlay.update(snapshot, { offsetX: 0, offsetY: 0 }, { width: 800, height: 600 }, player, null);
    update();
    expect(parent.children[0]?.visible).toBe(false);
    state.active = 'signposts';
    update();
    const layer = parent.children[0];
    expect(layer?.visible).toBe(true);
    expect(layer?.getLocalBounds().width).toBeGreaterThan(0);
    update(null);
    expect(layer?.visible).toBe(false);
    update();
    expect(layer?.visible).toBe(true);
    state.active = null;
    update();
    expect(layer?.visible).toBe(false);
    overlay.dispose();
    expect(parent.children).toHaveLength(0);
    parent.destroy();
  });
});
