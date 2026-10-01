import type { MinimapObjects } from '@open-northland/render';
import {
  cellOfNode,
  FOG_MODE,
  FOG_STATE,
  type FogView,
  halfCellMapFromCells,
  positionOfNode,
  Simulation,
  SnapshotMirror,
  type WorldSnapshot,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../src/catalog/buildings.js';
import { JOB_COLLECTOR } from '../src/catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../src/game/rules.js';
import { sandboxContent } from '../src/game/sandbox/content/index.js';
import { GOOD_IRON, GOOD_WHEAT, GOOD_WOOD } from '../src/game/sandbox/ids/index.js';
import { resourceCommand } from '../src/game/sandbox/place/index.js';
import { MINIMAP_OBJECT_TYPES } from '../src/hud/minimap/bake.js';
import {
  createSeenStandingObjects,
  minimapFeatureOfGoodTypes,
  standingNodesRevision,
} from '../src/hud/minimap/live-objects.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

const MAP_CELLS = 8;
const FEATURES = minimapFeatureOfGoodTypes([
  { id: 'wood', typeId: GOOD_WOOD },
  { id: 'iron', typeId: GOOD_IRON },
  { id: 'wheat', typeId: GOOD_WHEAT },
]);
const FOREST_TYPE = MINIMAP_OBJECT_TYPES.indexOf('forest');
const IRON_TYPE = MINIMAP_OBJECT_TYPES.indexOf('iron');
/** Ticks a novice collector takes at most to fell a tree. */
const MAX_FELL_TICKS = 4000;

/** The forest and ore of `snapshot` with fog off: every standing node. */
function standingObjects(snapshot: WorldSnapshot, features: typeof FEATURES): MinimapObjects {
  const seen = createSeenStandingObjects(features);
  seen.refresh(snapshot, null);
  return seen.objects();
}

/** A fog view of the viewer seat where `seenCells` are visible and every other cell explored. */
function fogSeeing(seenCells: readonly { cx: number; cy: number }[], generation: number): FogView {
  const visible = new Set(seenCells.map(({ cx, cy }) => cy * MAP_CELLS + cx));
  return {
    player: HUMAN_PLAYER,
    mode: FOG_MODE.RECON_FOG_OF_WAR,
    cellsWide: MAP_CELLS,
    cellsHigh: MAP_CELLS,
    generation,
    stateAt: (cx, cy) => (visible.has(cy * MAP_CELLS + cx) ? FOG_STATE.VISIBLE : FOG_STATE.EXPLORED),
  };
}

function standing(id: number, goodType: number, hx: number, hy: number): Ent {
  const { x, y } = positionOfNode(hx, hy);
  return { id, components: { Resource: { goodType, remaining: 1, harvestAtomic: 0 }, Position: { x, y } } };
}

describe('minimap standing objects', () => {
  it('draws wood as forest and iron as an iron field, and skips a good the minimap has no look for', () => {
    expect([...FEATURES]).toEqual([
      [GOOD_WOOD, 'forest'],
      [GOOD_IRON, 'iron'],
    ]);
    const snapshot = snapshotOf([
      standing(1, GOOD_WOOD, 4, 4),
      standing(2, GOOD_IRON, 10, 8),
      standing(3, GOOD_WHEAT, 6, 6),
    ]);
    expect(standingObjects(snapshot, FEATURES)).toEqual({
      types: MINIMAP_OBJECT_TYPES,
      placements: [4, 4, FOREST_TYPE, 10, 8, IRON_TYPE],
    });
  });

  it('follows a felled tree through the mirror and grows its revision', () => {
    const terrain = grassTerrain(MAP_CELLS, MAP_CELLS);
    const content = sandboxContent(terrain);
    const features = minimapFeatureOfGoodTypes(content.goods);
    expect(features.get(GOOD_WOOD)).toBe('forest');
    const sim = new Simulation({ seed: 1, content, map: halfCellMapFromCells(terrain) });
    const tree = resourceCommand(GOOD_WOOD, MAP_CELLS, MAP_CELLS);
    if (tree === null) throw new Error('missing wood gatherer');
    sim.enqueueSetup(tree);
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: JOB_COLLECTOR,
      x: MAP_CELLS,
      y: MAP_CELLS,
      tribe: PRIMARY_TRIBE,
      owner: HUMAN_PLAYER,
    });
    const deltas = sim.snapshotDeltas();
    const mirror = new SnapshotMirror();
    const advance = (): WorldSnapshot => {
      sim.step();
      const delta = deltas.next();
      if (delta !== null) mirror.apply(delta);
      return mirror.snapshot();
    };
    const planted = advance();
    const before = standingNodesRevision(planted, features);
    const [, , type, ...more] = standingObjects(planted, features).placements;
    expect([type, more]).toEqual([FOREST_TYPE, []]);
    let felled = false;
    for (let tick = 0; tick < MAX_FELL_TICKS && !felled; tick++) {
      advance();
      felled = sim.events.current().some((event) => event.kind === 'resourceFelled');
    }
    expect(felled).toBe(true);
    const after = mirror.snapshot();
    expect(standingNodesRevision(after, features)).toBeGreaterThan(before);
    expect(standingObjects(after, features).placements).toEqual([]);
    expect(mirror.verifyIndexes()).toEqual([]);
  });
});

describe('minimap seen standing objects', () => {
  const NEAR = { hx: 4, hy: 4 };
  const FAR = { hx: 10, hy: 8 };
  const nearCell = cellOfNode(NEAR.hx, NEAR.hy);
  const farCell = cellOfNode(FAR.hx, FAR.hy);
  const both = snapshotOf([standing(1, GOOD_WOOD, NEAR.hx, NEAR.hy), standing(2, GOOD_WOOD, FAR.hx, FAR.hy)]);

  it('drops a tree felled in a visible cell on the next refresh', () => {
    const seen = createSeenStandingObjects(FEATURES);
    const fog = fogSeeing([nearCell], 1);
    expect(seen.refresh(both, fog)).toBe(true);
    const felled = snapshotOf([standing(2, GOOD_WOOD, FAR.hx, FAR.hy)]);
    expect(seen.refresh(felled, fog)).toBe(true);
    expect(seen.objects().placements).toEqual([FAR.hx, FAR.hy, FOREST_TYPE]);
  });

  it('keeps a tree felled in an explored but hidden cell until the cell is seen', () => {
    const seen = createSeenStandingObjects(FEATURES);
    const hiding = fogSeeing([nearCell], 1);
    // The first refresh takes the standing forest everywhere, fog or not.
    seen.refresh(both, hiding);
    const felled = snapshotOf([standing(1, GOOD_WOOD, NEAR.hx, NEAR.hy)]);
    expect(seen.refresh(felled, hiding)).toBe(false);
    expect(seen.objects().placements).toEqual([NEAR.hx, NEAR.hy, FOREST_TYPE, FAR.hx, FAR.hy, FOREST_TYPE]);
    expect(seen.stale(felled, hiding)).toBe(false);

    const seeing = fogSeeing([nearCell, farCell], 2);
    expect(seen.stale(felled, seeing)).toBe(true);
    expect(seen.refresh(felled, seeing)).toBe(true);
    expect(seen.objects().placements).toEqual([NEAR.hx, NEAR.hy, FOREST_TYPE]);
    expect(seen.stale(felled, fogSeeing([nearCell], 3))).toBe(false);
  });

  it('takes every change with fog off', () => {
    const seen = createSeenStandingObjects(FEATURES);
    seen.refresh(both, fogSeeing([], 1));
    const replanted = snapshotOf([standing(3, GOOD_IRON, FAR.hx, FAR.hy)]);
    expect(seen.refresh(replanted, null)).toBe(true);
    expect(seen.objects().placements).toEqual([FAR.hx, FAR.hy, IRON_TYPE]);
  });
});
