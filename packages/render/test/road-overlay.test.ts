import { Container, Mesh, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import {
  cellsNearNode,
  type HalfTriangle,
  halfTrianglesA,
  halfTrianglesB,
  type NodeXY,
  ROAD_GROUND_PATTERN,
  ROAD_TRANSITIONS,
  roadPaintOf,
  roadVariant,
  triangleANodes,
  triangleBNodes,
  triangleRoadNodes,
} from '../src/data/terrain/index.js';
import { TerrainLayer } from '../src/gpu/terrain/index.js';
import type { TerrainTextureSet } from '../src/gpu/terrain-textures.js';
import { useHeadlessShaderContext } from './support/shader-context.js';

useHeadlessShaderContext();

/** A node's column in the original's frame, where odd rows sit half a node right. */
function frameX([hx, hy]: NodeXY): number {
  return hx + (hy % 2 === 1 ? 0.5 : 0);
}

const CELLS: readonly (readonly [number, number])[] = [
  [2, 2],
  [2, 3],
  [5, 4],
  [0, 1],
];

describe('road half triangles', () => {
  for (const [name, halves, corners] of [
    ['A', halfTrianglesA, triangleANodes],
    ['B', halfTrianglesB, triangleBNodes],
  ] as const) {
    it(`put each of triangle ${name}'s half-triangle nodes where its corner weights place it`, () => {
      for (const [col, row] of CELLS) {
        const c = corners(col, row);
        for (const half of halves(col, row)) {
          for (const [i, w] of half.weights.entries()) {
            const node = half.nodes[i] as NodeXY;
            const x = w[0] * frameX(c[0]) + w[1] * frameX(c[1]) + w[2] * frameX(c[2]);
            const y = w[0] * c[0][1] + w[1] * c[1][1] + w[2] * c[2][1];
            expect([frameX(node), node[1]]).toEqual([x, y]);
          }
        }
      }
    });

    it(`split triangle ${name} into four halves over its six road nodes`, () => {
      const which = name === 'A' ? 'a' : 'b';
      for (const [col, row] of CELLS) {
        const spanned = new Set(halves(col, row).flatMap((h) => h.nodes.map(([x, y]) => `${x},${y}`)));
        const listed = new Set(triangleRoadNodes(col, row, which).map(([x, y]) => `${x},${y}`));
        expect(spanned).toEqual(listed);
        expect(listed.size).toBe(6);
      }
    });
  }

  it('finds every triangle a node is a corner of among its nearby cells', () => {
    const size = 8;
    for (let hy = 2; hy < 2 * size - 2; hy++) {
      for (let hx = 2; hx < 2 * size - 2; hx++) {
        const near = new Set(cellsNearNode(hx, hy).map(([c, r]) => `${c},${r}`));
        for (let row = 0; row < size; row++) {
          for (let col = 0; col < size; col++) {
            const touches = (['a', 'b'] as const).some((which) =>
              triangleRoadNodes(col, row, which).some(([x, y]) => x === hx && y === hy),
            );
            if (touches) expect(near.has(`${col},${row}`)).toBe(true);
          }
        }
      }
    }
  });
});

describe('roadPaintOf', () => {
  const [top] = halfTrianglesA(2, 2) as readonly HalfTriangle[];
  if (top === undefined) throw new Error('expected a half triangle');
  const idOf = ([hx, hy]: NodeXY): number => hy * 100 + hx;
  const roadOver =
    (nodes: readonly NodeXY[]) =>
    (hx: number, hy: number): number | undefined =>
      nodes.some(([x, y]) => x === hx && y === hy) ? idOf([hx, hy]) : undefined;

  it('paints nothing off the road and the whole road ground under three road corners', () => {
    expect(roadPaintOf(top, roadOver([])).kind).toBe('none');
    expect(roadPaintOf(top, roadOver(top.nodes)).kind).toBe('ground');
  });

  it("picks the pair opaque at exactly the road corners, in the first road corner's variant", () => {
    const [apex, se, sw] = top.nodes;
    // Pair 5 of `coordsA` is opaque at its first point only, pair 1 at its first two, pair 4 at its last.
    expect(roadPaintOf(top, roadOver([apex]))).toEqual({
      kind: 'edge',
      variant: roadVariant(idOf(apex)),
      pair: 5,
    });
    expect(roadPaintOf(top, roadOver([apex, se]))).toEqual({
      kind: 'edge',
      variant: roadVariant(idOf(apex)),
      pair: 1,
    });
    expect(roadPaintOf(top, roadOver([sw]))).toEqual({
      kind: 'edge',
      variant: roadVariant(idOf(sw)),
      pair: 4,
    });
  });

  it('gives a node a fixed variant and uses both across nodes', () => {
    const variants = new Set(Array.from({ length: 64 }, (_, id) => roadVariant(id)));
    expect(variants).toEqual(new Set([0, 1]));
    expect(roadVariant(1234)).toBe(roadVariant(1234));
  });
});

const PAGE = 'road-page';
const PAIRS = 6;
const coordsTuple = [0, 0, 63, 63, 0, 63];
const roadTextures: TerrainTextureSet = {
  pages: new Map([[PAGE, Texture.WHITE.source]]),
  cellFor: () => ({ pageKey: PAGE, rect: { x: 0, y: 0, w: 1, h: 1 } }),
  groundFor: (name) =>
    name === ROAD_GROUND_PATTERN ? { pageKey: PAGE, coordsA: coordsTuple, coordsB: coordsTuple } : undefined,
  transitionFor: (name) =>
    (ROAD_TRANSITIONS as readonly string[]).includes(name)
      ? {
          pageKey: PAGE,
          coordsA: Array.from({ length: PAIRS }, () => coordsTuple),
          coordsB: Array.from({ length: PAIRS }, () => coordsTuple),
        }
      : undefined,
};

const WIDTH = 70;
const HEIGHT = 4;
const grid = { width: WIDTH, height: HEIGHT, typeIds: Array.from({ length: WIDTH * HEIGHT }, () => 0) };
const NODE_WIDTH = 2 * WIDTH;

/** The road meshes of each terrain block: its trailing containers, the ground being meshes. */
function roadTriangles(layer: TerrainLayer): number[] {
  return layer.container.children.map((chunk) =>
    chunk.children
      .filter((child): child is Container => child instanceof Container && !(child instanceof Mesh))
      .flatMap((c) => c.children)
      .filter((child): child is Mesh => child instanceof Mesh)
      .reduce((sum, mesh) => sum + mesh.geometry.indices.length / 3, 0),
  );
}

/** A viewport over the whole test map. */
const EVERYWHERE = { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 };

/** Hand `layer` a road change and cull it to `viewport`, which meshes the changed blocks it shows. */
function change(
  layer: TerrainLayer,
  added: readonly number[],
  removed: readonly number[] = [],
  viewport = EVERYWHERE,
): void {
  layer.updateRoads({ added, removed });
  layer.cull(viewport);
}

describe('TerrainLayer roads', () => {
  it('meshes a road node into the half triangles around it, only in its own block', () => {
    const layer = new TerrainLayer();
    layer.set(grid, roadTextures);
    // A cell centre is a corner of six ground triangles and so of six half triangles.
    change(layer, [4 * NODE_WIDTH + 4]);
    expect(roadTriangles(layer)).toEqual([6, 0, 0]);
    change(layer, [], [4 * NODE_WIDTH + 4]);
    expect(roadTriangles(layer)).toEqual([0, 0, 0]);
    layer.destroy();
  });

  it('re-meshes only the blocks a change touches', () => {
    const layer = new TerrainLayer();
    layer.set(grid, roadTextures);
    change(layer, [4 * NODE_WIDTH + 4]);
    const [first] = layer.container.children;
    const before = first?.children.at(-1);
    change(layer, [4 * NODE_WIDTH + 100]);
    expect(first?.children.at(-1)).toBe(before);
    expect(roadTriangles(layer)).toEqual([6, 6, 0]);
    layer.destroy();
  });

  it('keeps the road set across a map rebuild', () => {
    const layer = new TerrainLayer();
    layer.set(grid, roadTextures);
    change(layer, [4 * NODE_WIDTH + 4]);
    layer.set(grid, roadTextures);
    layer.cull(EVERYWHERE);
    expect(roadTriangles(layer)).toEqual([6, 0, 0]);
    layer.destroy();
  });
});
