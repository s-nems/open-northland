import { lastByTypeId } from '@open-northland/data';
import type { BuildingHighlightItem } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_CARRIER, JOB_COLLECTOR } from '../src/catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../src/game/rules.js';
import { canonicalJobType, rebaseSlotJob } from '../src/game/sandbox/ids/index.js';
import { isBuilding, isSettler, ownerPlayerOf, settlerJobType } from '../src/game/snapshot.js';
import { createSceneSim, getScene } from '../src/scenes/index.js';
import {
  type AssignBuildingInfo,
  computeAssignHighlight,
  tradeSlotsOf,
  workerGroupAt,
} from '../src/view/unit-controls/highlights/index.js';
import { buildingPickController } from './support/pick-mode.js';
import { countingSnapshot, type Ent, snapshotOf } from './support/snapshot.js';

/**
 * The "przydziel miejsce pracy" verdict - the button places each settler's CURRENT trade only, so a
 * building is green iff it offers that exact trade (canonically) with a free slot. Matched by
 * `canonicalJobType`, so a picker-assigned raw id lines up with the building's rebased slot id.
 */

const COIN_MAKER = 14; // jobtypes.ini coin maker (a picker/raw id)
const MILL_SLOTS = [
  { jobType: 19, count: 2 }, // miller
  { jobType: JOB_CARRIER, count: 1 },
];
// A mint whose coin-maker slot is sandbox-rebased (14 -> 1014), the id space the browser/headless slots use.
const MINT_SLOTS = [
  { jobType: rebaseSlotJob(COIN_MAKER), count: 2 },
  { jobType: JOB_CARRIER, count: 1 },
];
const WAREHOUSE_SLOTS = [
  { jobType: JOB_CARRIER, count: 3 },
  { jobType: rebaseSlotJob(JOB_COLLECTOR), count: 3 }, // a collector (gatherer) slot
];

describe('tradeSlotsOf - the slots that seat a current trade', () => {
  it('matches the rebased coin-maker slot of a mint to the raw current id', () => {
    expect(tradeSlotsOf(COIN_MAKER, MINT_SLOTS)).toEqual([rebaseSlotJob(COIN_MAKER)]);
  });

  it('offers a coin-maker nothing at a mill, which does not employ that trade', () => {
    expect(tradeSlotsOf(COIN_MAKER, MILL_SLOTS)).toEqual([]);
  });

  it('matches a collector to the gatherer slot of a warehouse', () => {
    expect(tradeSlotsOf(JOB_COLLECTOR, WAREHOUSE_SLOTS)).toEqual([rebaseSlotJob(JOB_COLLECTOR)]);
  });

  it('never falls back to the carrier - a miller at a mint gets no slot, not a hauler post', () => {
    expect(tradeSlotsOf(19, MINT_SLOTS)).toEqual([]);
  });

  it('offers a jobless settler nothing', () => {
    expect(tradeSlotsOf(undefined, MINT_SLOTS)).toEqual([]);
  });
});

/**
 * The snapshot-level projection over real sandbox content - the functions the view actually calls. The
 * key invariant: the highlight verdict (`computeAssignHighlight`, what the player sees green) and the click
 * resolver (`workerGroupAt`, what a click posts) must agree building-for-building, so a green
 * building never silently cancels the click and a red one never binds. Both read one verdict; this
 * proves they stay in lockstep over a live world.
 */
describe('computeAssignHighlight / workerGroupAt over sandbox content', () => {
  it('highlights own candidate buildings and the green/red verdict matches what a click would bind', () => {
    const scene = getScene('sandbox');
    if (scene === undefined) throw new Error('sandbox scene missing');
    const sim = createSceneSim(scene);
    sim.step();
    const snapshot = sim.snapshot();
    const buildingsByType = lastByTypeId(sim.content.buildings);

    // A camp collector: the sandbox posts every craft and transport slot at build, so a collector's trade
    // is the one with openings left - the warehouses' gatherer slots, which a fixture never staffs.
    const settler = snapshot.entities.find(
      (e) =>
        isSettler(e) &&
        ownerPlayerOf(e) === HUMAN_PLAYER &&
        settlerJobType(e) === canonicalJobType(JOB_COLLECTOR),
    );
    if (settler === undefined) throw new Error('no owned collector in the sandbox');

    const items = computeAssignHighlight(snapshot, [settler.id], buildingsByType);
    expect(items.length).toBeGreaterThan(0); // some own building employs someone

    // Lockstep: for every highlighted building, `ok` iff the click resolver would post the settler there.
    for (const item of items) {
      const workers = workerGroupAt(snapshot, item.id, [settler.id], buildingsByType);
      expect(item.ok).toBe(workers !== null);
    }
    // At least one candidate is green (the settler's trade has an open slot somewhere) and the resolver
    // posts the settler there under a real job id.
    const green = items.find((i) => i.ok);
    expect(green).toBeDefined();
    expect(workerGroupAt(snapshot, green?.id ?? -1, [settler.id], buildingsByType)).toEqual([
      { entity: settler.id, jobPriority: [expect.any(Number)] },
    ]);

    // Every highlighted building is one the player owns (a candidate), never an enemy/neutral building.
    const byId = new Map(snapshot.entities.map((e) => [e.id, e]));
    for (const item of items) {
      const b = byId.get(item.id);
      expect(b !== undefined && isBuilding(b) && ownerPlayerOf(b) === HUMAN_PLAYER).toBe(true);
    }
  });
});

describe('a building still under construction', () => {
  const MINT = 40;
  const byType = new Map<number, AssignBuildingInfo>([[MINT, { workers: MINT_SLOTS }]]);
  /** A coin-maker and a mint FOUNDATION, both the human player's. */
  const world = (): WorldSnapshot =>
    snapshotOf([
      {
        id: 1,
        components: {
          Settler: { tribe: PRIMARY_TRIBE, jobType: COIN_MAKER },
          Owner: { player: HUMAN_PLAYER },
        },
      },
      {
        id: 2,
        components: {
          Building: { buildingType: MINT, tribe: PRIMARY_TRIBE },
          UnderConstruction: { labor: 0 },
          Owner: { player: HUMAN_PLAYER },
        },
      },
    ]);

  it('is a candidate, greened for the trade it will employ', () => {
    const snapshot = world();
    expect(computeAssignHighlight(snapshot, [1], byType)).toEqual([{ id: 2, ok: true }]);
    expect(workerGroupAt(snapshot, 2, [1], byType)).toEqual([
      { entity: 1, jobPriority: [rebaseSlotJob(COIN_MAKER)] },
    ]);
  });
});

describe('a workplace pick armed for a group', () => {
  const MINT = 40;
  const OTHER_MINT = 41;
  const byType = new Map<number, AssignBuildingInfo>([
    [MINT, { workers: MINT_SLOTS }],
    [OTHER_MINT, { workers: MINT_SLOTS }],
  ]);
  const coinMaker = (id: number, workplace?: number): Ent => ({
    id,
    components: {
      Settler: { tribe: PRIMARY_TRIBE, jobType: rebaseSlotJob(COIN_MAKER) },
      Owner: { player: HUMAN_PLAYER },
      ...(workplace !== undefined ? { JobAssignment: { workplace } } : {}),
    },
  });
  const mint = (id: number, typeId = MINT): Ent => ({
    id,
    components: {
      Building: { buildingType: typeId, tribe: PRIMARY_TRIBE },
      Owner: { player: HUMAN_PLAYER },
    },
  });

  it('reds a workplace whose matching slot is full, with no fallback to another trade', () => {
    const snapshot = snapshotOf([coinMaker(1, 10), coinMaker(2, 10), coinMaker(3), mint(10)]);
    expect(computeAssignHighlight(snapshot, [3], byType)).toEqual([{ id: 10, ok: false }]);
    expect(workerGroupAt(snapshot, 10, [3], byType)).toBeNull();
  });

  it('reds a full workplace a selected member already works at', () => {
    const snapshot = snapshotOf([coinMaker(1, 10), coinMaker(2, 10), coinMaker(3), mint(10)]);
    expect(computeAssignHighlight(snapshot, [1, 3], byType)).toEqual([{ id: 10, ok: false }]);
    expect(workerGroupAt(snapshot, 10, [1, 3], byType)).toBeNull();
  });

  it('greens a workplace for the unemployed members and posts every member it offers a trade', () => {
    const snapshot = snapshotOf([coinMaker(1, 10), coinMaker(2), mint(10), mint(11, OTHER_MINT)]);
    expect(computeAssignHighlight(snapshot, [1, 2], byType)).toEqual([
      { id: 10, ok: true },
      { id: 11, ok: true },
    ]);
    expect(workerGroupAt(snapshot, 11, [1, 2], byType)?.map((w) => w.entity)).toEqual([1, 2]);
  });
});

/**
 * The frame loop reads `highlight()` every RAF frame while the assign gesture is armed, but the pass it
 * runs is O(entities) (twice over, with the staffing map). It must therefore run once per snapshot, not
 * once per frame - while still re-colouring as soon as the world changes or another settler is armed.
 */
describe('pick-mode highlight cost', () => {
  it('scans the world once per snapshot, not once per frame, and re-scans for a new arm', () => {
    const scene = getScene('sandbox');
    if (scene === undefined) throw new Error('sandbox scene missing');
    const sim = createSceneSim(scene);
    sim.step();
    const buildingsByType = lastByTypeId(sim.content.buildings);
    // Two settlers of DIFFERENT trades, so the wash they each produce differs.
    const owned = sim.snapshot().entities.filter((e) => isSettler(e) && ownerPlayerOf(e) === HUMAN_PLAYER);
    const settler = owned[0];
    if (settler === undefined) throw new Error('no owned settler in the sandbox');
    const other = owned.find((e) => settlerJobType(e) !== settlerJobType(settler));
    if (other === undefined) throw new Error('expected a second owned settler of another trade');

    const source = sim.snapshot();
    const first = countingSnapshot(source);
    let current: WorldSnapshot = first.snapshot;
    const pick = buildingPickController({ snapshot: () => current, content: sim.content });

    pick.arm({ kind: 'workplace', units: [settler.id] });
    const frame = (): readonly BuildingHighlightItem[] | null => pick.highlight();
    const wash = frame();
    const afterFirst = first.scans();
    expect(afterFirst).toBeGreaterThan(0);
    expect(wash).toEqual(computeAssignHighlight(source, [settler.id], buildingsByType));
    // The next frames reuse the memo: no rescan, and the very same array the renderer already holds.
    expect(frame()).toBe(wash);
    expect(frame()).toBe(wash);
    expect(first.scans()).toBe(afterFirst);

    // A new arm re-colours for the newly armed settler, on the same snapshot.
    pick.arm({ kind: 'workplace', units: [other.id] });
    expect(frame()).toEqual(computeAssignHighlight(source, [other.id], buildingsByType));
    expect(first.scans()).toBeGreaterThan(afterFirst);

    // A fresh snapshot (a tick that may have changed the world) re-scans.
    sim.step();
    const second = countingSnapshot(sim.snapshot());
    current = second.snapshot;
    frame();
    expect(second.scans()).toBeGreaterThan(0);

    // Cancelling stops the work entirely.
    pick.cancel();
    const before = second.scans();
    expect(frame()).toBeNull();
    expect(second.scans()).toBe(before);
  });
});
