import {
  components,
  type EntityDelta,
  type EntitySnapshot,
  type Fixed,
  fx,
  type HalfCellNode,
  heapReach,
  IDLE_JOB,
  nodeOfPosition,
  packSnapshotDelta,
  Simulation,
  SnapshotMirror,
  systems,
  type TerrainMap,
  type WorldSnapshot,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import { buildHud, type HudModel, type JobCount, type StockCount } from '../src/data/hud/index.js';
import { hudTotalsOf } from '../src/data/hud/totals.js';
import {
  readAmountPairs,
  readNumField,
  readPosition,
  readStockpileAmounts,
} from '../src/data/snapshot/index.js';

/**
 * `buildHud` reads figures the snapshot's indexes keep per change. Over a mirror fed delta by delta, the
 * maintained model must equal a walk over the mirror's whole entity list after every change.
 */

const PLAYER = 0;
const RIVAL = 1;
/** A seat that owns nothing at all. */
const NOBODY = 2;
const SEATS = [PLAYER, RIVAL, NOBODY] as const;

/** The per-tick walk `buildHud` replaced, kept as the reference the maintained figures must match. */
function walkHud(snapshot: WorldSnapshot, player: number): HudModel {
  let population = 0;
  const jobCounts = new Map<number, { count: number; female: number }>();
  const stockTotals = new Map<number, number>();
  const addPairs = (pairs: readonly (readonly [number, number])[]): void => {
    for (const [goodType, amount] of pairs)
      stockTotals.set(goodType, (stockTotals.get(goodType) ?? 0) + amount);
  };
  const nodeOf = (c: Readonly<Record<string, unknown>>): HalfCellNode | null => {
    const p = readPosition(c);
    return p === null ? null : nodeOfPosition(p.x as Fixed, p.y as Fixed);
  };
  const anchors: HalfCellNode[] = [];
  const heaps: Readonly<Record<string, unknown>>[] = [];
  for (const { components: c } of snapshot.entities) {
    const owner = readNumField(c, 'Owner', 'player');
    if (owner === undefined) {
      if ('Stockpile' in c && 'Position' in c) heaps.push(c);
      continue;
    }
    if (owner !== player) continue;
    if ('Signpost' in c || 'Building' in c) {
      const node = nodeOf(c);
      if (node !== null) anchors.push(node);
    }
    if ('Person' in c) {
      population++;
      const jobType = readNumField(c, 'Settler', 'jobType') ?? IDLE_JOB;
      const tally = jobCounts.get(jobType) ?? { count: 0, female: 0 };
      tally.count++;
      if ('Female' in c) tally.female++;
      jobCounts.set(jobType, tally);
    }
    addPairs(readStockpileAmounts(c));
    const upgrading = c.Upgrading as { savedStock?: unknown } | undefined;
    if (upgrading !== undefined) addPairs(readAmountPairs(upgrading.savedStock));
    const carriedGood = readNumField(c, 'Carrying', 'goodType');
    const carriedAmount = readNumField(c, 'Carrying', 'amount');
    if (carriedGood !== undefined && carriedAmount !== undefined) addPairs([[carriedGood, carriedAmount]]);
  }
  const inReach = heapReach(anchors);
  for (const heap of heaps) {
    const node = nodeOf(heap);
    if (node !== null && inReach(node)) addPairs(readStockpileAmounts(heap));
  }
  const jobs: JobCount[] = [...jobCounts.entries()]
    .map(([jobType, { count, female }]) => ({ jobType, count, female }))
    .sort((a, b) => a.jobType - b.jobType);
  const stocks: StockCount[] = [...stockTotals.entries()]
    .filter(([, amount]) => amount !== 0)
    .map(([goodType, amount]) => ({ goodType, amount }))
    .sort((a, b) => a.goodType - b.goodType);
  return { tick: snapshot.tick, player, population, jobs, stocks };
}

function expectMatchesWalk(snapshot: WorldSnapshot): void {
  for (const seat of SEATS) expect(buildHud(snapshot, seat)).toEqual(walkHud(snapshot, seat));
}

function nonNull<T>(value: T | null): T {
  if (value === null) throw new Error('expected a value');
  return value;
}

const at = (x: number, y: number) => ({ x: fx.fromInt(x), y: fx.fromInt(y) });

const WOOD = 1;
const STONE = 2;
const WOODCUTTER = 5;
const MINER = 7;
const HEAD_OFFICE = 0;
const BUILT = 1;

const SIGNPOST_ID = 1;
const SETTLER_ID = 2;
const STORE_ID = 3;
const NEAR_HEAP_ID = 4;
const FAR_HEAP_ID = 5;
const RIVAL_SETTLER_ID = 6;
const LATE_BUILDING_ID = 7;

/** Inside the fifty-node walk range of the signpost at (10, 10); the far spot is beyond it. */
const NEAR = { x: 12, y: 11 } as const;
const FAR = { x: 70, y: 70 } as const;
const HOME = { x: 10, y: 10 } as const;
const LATE_SITE = { x: 71, y: 70 } as const;

const OPENING: readonly EntitySnapshot[] = [
  {
    id: SIGNPOST_ID,
    components: { Signpost: { links: [] }, Position: at(HOME.x, HOME.y), Owner: { player: PLAYER } },
  },
  {
    id: SETTLER_ID,
    components: {
      Settler: { tribe: 0, jobType: WOODCUTTER },
      Person: { person: true },
      Female: {},
      Owner: { player: PLAYER },
      Position: at(HOME.x, HOME.y),
    },
  },
  {
    id: STORE_ID,
    components: {
      Building: { tribe: 0, buildingType: HEAD_OFFICE, built: BUILT },
      Stockpile: { amounts: [[WOOD, 10]] },
      Upgrading: { savedStock: [[STONE, 3]], seeded: [] },
      Owner: { player: PLAYER },
    },
  },
  { id: NEAR_HEAP_ID, components: { Stockpile: { amounts: [[WOOD, 4]] }, Position: at(NEAR.x, NEAR.y) } },
  { id: FAR_HEAP_ID, components: { Stockpile: { amounts: [[STONE, 9]] }, Position: at(FAR.x, FAR.y) } },
  {
    id: RIVAL_SETTLER_ID,
    components: {
      Settler: { tribe: 0, jobType: MINER },
      Person: { person: true },
      Owner: { player: RIVAL },
      Carrying: { goodType: STONE, amount: 1 },
    },
  },
];

function touch(
  id: number,
  written: Readonly<Record<string, unknown>>,
  removed: readonly string[] = [],
): EntityDelta {
  return { id, components: written, removed };
}

/** Each step is one delta after the opening rebuild; ids in `touched` ascend, as a stream's do. */
const STEPS: readonly { readonly touched?: readonly EntityDelta[]; readonly removed?: readonly number[] }[] =
  [
    // A component the HUD never reads: every part short-circuits on identity.
    { touched: [touch(SETTLER_ID, { Health: { hp: 1 } })] },
    // The near heap walks out of reach, then back in.
    { touched: [touch(NEAR_HEAP_ID, { Position: at(FAR.x + 1, FAR.y) })] },
    { touched: [touch(NEAR_HEAP_ID, { Position: at(NEAR.x, NEAR.y) })] },
    // A building placed later opens the far heap.
    {
      touched: [
        touch(LATE_BUILDING_ID, {
          Building: { tribe: 0, buildingType: HEAD_OFFICE, built: 0 },
          Position: at(LATE_SITE.x, LATE_SITE.y),
          Owner: { player: PLAYER },
        }),
      ],
    },
    // Construction progress rewrites the building but keeps its node.
    {
      touched: [touch(LATE_BUILDING_ID, { Building: { tribe: 0, buildingType: HEAD_OFFICE, built: BUILT } })],
    },
    // A heap in reach changes its amounts; a new heap drops beside the far one.
    {
      touched: [
        touch(FAR_HEAP_ID, {
          Stockpile: {
            amounts: [
              [STONE, 2],
              [WOOD, 1],
            ],
          },
        }),
      ],
    },
    {
      touched: [
        touch(LATE_BUILDING_ID + 1, { Stockpile: { amounts: [[WOOD, 5]] }, Position: at(FAR.x, FAR.y + 1) }),
      ],
    },
    // The settler changes job, then picks a unit up, then puts it down.
    { touched: [touch(SETTLER_ID, { Settler: { tribe: 0, jobType: MINER } })] },
    { touched: [touch(SETTLER_ID, { Carrying: { goodType: WOOD, amount: 1 } })] },
    { touched: [touch(SETTLER_ID, {}, ['Carrying'])] },
    // The upgrading store's stash changes, then the upgrade finishes.
    {
      touched: [
        touch(STORE_ID, {
          Upgrading: {
            savedStock: [
              [STONE, 5],
              [WOOD, 2],
            ],
            seeded: [],
          },
        }),
      ],
    },
    { touched: [touch(STORE_ID, { Stockpile: { amounts: [[WOOD, 12]] } }, ['Upgrading'])] },
    // A seat claims a heap, and the store changes hands.
    { touched: [touch(NEAR_HEAP_ID, { Owner: { player: PLAYER } })] },
    { touched: [touch(STORE_ID, { Owner: { player: RIVAL } })] },
    // The late building is torn down and the settler dies: the far heaps drop out of reach again.
    { removed: [SETTLER_ID, LATE_BUILDING_ID] },
    // The signpost moves, then goes.
    { touched: [touch(SIGNPOST_ID, { Position: at(FAR.x, FAR.y + 2) })] },
    { removed: [SIGNPOST_ID] },
  ];

describe('buildHud over a mirror', () => {
  it('keeps the walked figures through every hand-built change', () => {
    const mirror = new SnapshotMirror();
    const opening = OPENING.map((entity) => touch(entity.id, entity.components));
    mirror.apply(
      packSnapshotDelta({ tick: 1, sequence: 0, rebuild: true, touched: opening, removed: [], events: [] }),
    );
    expectMatchesWalk(mirror.snapshot());
    const heldBefore = buildHud(mirror.snapshot(), PLAYER);
    expect(heldBefore.stocks).toEqual([
      { goodType: WOOD, amount: 14 },
      { goodType: STONE, amount: 3 },
    ]);
    for (const [i, step] of STEPS.entries()) {
      const tick = i + 2;
      const delta = packSnapshotDelta({
        tick,
        sequence: tick - 1,
        rebuild: false,
        touched: step.touched ?? [],
        removed: step.removed ?? [],
        events: [],
      });
      mirror.apply(delta);
      expectMatchesWalk(mirror.snapshot());
      expect(mirror.verifyIndexes()).toEqual([]);
    }
  });

  it('settles a stale reach over heaps that changed while nobody read the player', () => {
    const SECOND_SITE = { x: 68, y: 72 } as const;
    const SECOND_BUILDING_ID = LATE_BUILDING_ID + 1;
    const FAR_STONE = 2;
    /** The opening store's upgrade stash. */
    const STASHED_STONE = 3;
    const NEW_HEAP_ID = LATE_BUILDING_ID + 2;
    const mirror = new SnapshotMirror();
    const opening = OPENING.map((entity) => touch(entity.id, entity.components));
    mirror.apply(
      packSnapshotDelta({ tick: 1, sequence: 0, rebuild: true, touched: opening, removed: [], events: [] }),
    );
    // One read registers the maintained totals; every later delta is applied without reading them.
    expectMatchesWalk(mirror.snapshot());
    const building = (site: { x: number; y: number }) => ({
      Building: { tribe: 0, buildingType: HEAD_OFFICE, built: BUILT },
      Position: at(site.x, site.y),
      Owner: { player: PLAYER },
    });
    const steps: readonly {
      readonly touched?: readonly EntityDelta[];
      readonly removed?: readonly number[];
    }[] = [
      // An anchor beside the far heap stales the player's reach.
      { touched: [touch(LATE_BUILDING_ID, building(LATE_SITE))] },
      // Heaps come, change and go while the reach is stale.
      {
        touched: [
          touch(NEW_HEAP_ID, { Stockpile: { amounts: [[WOOD, 5]] }, Position: at(FAR.x, FAR.y + 1) }),
        ],
      },
      { touched: [touch(FAR_HEAP_ID, { Stockpile: { amounts: [[STONE, FAR_STONE]] } })] },
      { removed: [NEAR_HEAP_ID] },
      // A second anchor while still stale, then a heap walks and a new one's amounts change.
      { touched: [touch(SECOND_BUILDING_ID, building(SECOND_SITE))] },
      { touched: [touch(FAR_HEAP_ID, { Position: at(SECOND_SITE.x, SECOND_SITE.y + 1) })] },
      { touched: [touch(NEW_HEAP_ID, { Stockpile: { amounts: [[WOOD, 7]] } })] },
    ];
    for (const [i, step] of steps.entries()) {
      const tick = i + 2;
      mirror.apply(
        packSnapshotDelta({
          tick,
          sequence: tick - 1,
          rebuild: false,
          touched: step.touched ?? [],
          removed: step.removed ?? [],
          events: [],
        }),
      );
      expect(mirror.verifyIndexes()).toEqual([]);
    }
    const snapshot = mirror.snapshot();
    const read = buildHud(snapshot, PLAYER);
    expect(read).toEqual(walkHud(snapshot, PLAYER));
    // The moved far heap counts: the settled reach covers the second anchor.
    expect(read.stocks).toContainEqual({ goodType: STONE, amount: FAR_STONE + STASHED_STONE });
    expectMatchesWalk(snapshot);
    expect(mirror.verifyIndexes()).toEqual([]);
    // A settled heap total that drifted from its heaps is reported; a stale one is derived again on read.
    const heapStock = hudTotalsOf(snapshot, PLAYER)?.heapStock as Map<number, number>;
    heapStock.set(WOOD, (heapStock.get(WOOD) ?? 0) + 1);
    expect(mirror.verifyIndexes()).toEqual([expect.stringContaining(`player ${PLAYER} heap stock`)]);
  });

  it('keeps the walked figures through a running settlement', () => {
    const GRASS = 0;
    const CARRIER = 36;
    const HEADQUARTERS = 1;
    const SAWMILL = 2;
    const VIKING = 1;
    const HARVEST_ATOMIC = 24;
    const MAP_WIDTH = 10;
    const MAP_HEIGHT = 2;
    const RUN_TICKS = 400;
    const LATE_PLACEMENT_TICK = 150;
    const TREE_COLUMNS = [2, 3];
    const map: TerrainMap = {
      resolution: 'half-cell',
      width: MAP_WIDTH,
      height: MAP_HEIGHT,
      typeIds: new Array(MAP_WIDTH * MAP_HEIGHT).fill(GRASS),
    };
    const sim = new Simulation({ seed: 7, content: testContent(), map });
    const owned = { tribe: VIKING, owner: PLAYER } as const;
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 5, y: 0, ...owned });
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, ...owned });
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: CARRIER, x: 1, y: 0, ...owned });
    for (const x of TREE_COLUMNS) {
      const tree = sim.world.create();
      sim.world.add(tree, components.Position, { x: fx.fromInt(x), y: fx.fromInt(0) });
      sim.world.add(tree, components.Resource, {
        goodType: WOOD,
        remaining: 4,
        harvestAtomic: HARVEST_ATOMIC,
      });
      systems.stampResourceFootprintOrFallback(sim.world, sim.content, tree, WOOD);
    }
    const deltas = sim.snapshotDeltas();
    const mirror = new SnapshotMirror();
    let sawStock = false;
    for (let tick = 1; tick <= RUN_TICKS; tick++) {
      if (tick === LATE_PLACEMENT_TICK) {
        sim.enqueueSetup({ kind: 'placeBuilding', buildingType: SAWMILL, x: 8, y: 1, ...owned });
      }
      sim.step();
      mirror.apply(nonNull(deltas.next()));
      const snapshot = mirror.snapshot();
      expectMatchesWalk(snapshot);
      expect(mirror.verifyIndexes()).toEqual([]);
      if (buildHud(snapshot, PLAYER).stocks.length > 0) sawStock = true;
    }
    expect(buildHud(mirror.snapshot(), PLAYER).population).toBe(2);
    expect(sawStock).toBe(true);
  });
});
