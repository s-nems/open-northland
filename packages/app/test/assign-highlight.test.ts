import { type ContentSet, lastByTypeId } from '@open-northland/data';
import type { BuildingHighlightItem } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_CARRIER, JOB_COLLECTOR } from '../src/catalog/jobs.js';
import { HUMAN_PLAYER } from '../src/game/rules.js';
import { rebaseSlotJob } from '../src/game/sandbox/ids/index.js';
import { isBuilding, isSettler, ownerPlayerOf, settlerJobType } from '../src/game/snapshot.js';
import { createSceneSim, getScene } from '../src/scenes/index.js';
import {
  assignableJobForBuilding,
  computeAssignHighlight,
  currentTradeSlotAt,
} from '../src/view/unit-controls/highlights/index.js';
import { createPickModeController, type PickModeController } from '../src/view/unit-controls/pick-mode.js';
import { countingSnapshot } from './support/snapshot.js';

/**
 * The "przydziel miejsce pracy" verdict - the button places the settler's CURRENT trade only, so a
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

describe('currentTradeSlotAt - the current-trade green/red verdict', () => {
  it('greens a mint for a coin-maker, matching the rebased slot to the raw current id', () => {
    // The settler is a coin-maker (raw id 14); the mint slot is rebased (1014). They match canonically.
    expect(currentTradeSlotAt(COIN_MAKER, MINT_SLOTS, undefined)).toBe(rebaseSlotJob(COIN_MAKER));
  });

  it('reds a mill for a coin-maker - the building does not offer that trade', () => {
    expect(currentTradeSlotAt(COIN_MAKER, MILL_SLOTS, undefined)).toBeNull();
  });

  it('reds a building whose matching slot is already full (no re-trade, no fallback)', () => {
    const full = new Map<number, number>([[rebaseSlotJob(COIN_MAKER), 2]]);
    expect(currentTradeSlotAt(COIN_MAKER, MINT_SLOTS, full)).toBeNull();
  });

  it('greens a warehouse for a collector via its gatherer slot', () => {
    expect(currentTradeSlotAt(JOB_COLLECTOR, WAREHOUSE_SLOTS, undefined)).toBe(rebaseSlotJob(JOB_COLLECTOR));
  });

  it('never falls back to the carrier - a miller on a mint stays red, not a hauler', () => {
    // The button does not re-trade: a miller aimed at a mint (no miller slot) is red, never bound as carrier.
    expect(currentTradeSlotAt(19, MINT_SLOTS, undefined)).toBeNull();
  });

  it('reds an employed-nobody / jobless case', () => {
    expect(currentTradeSlotAt(COIN_MAKER, undefined, undefined)).toBeNull();
    expect(currentTradeSlotAt(undefined, MINT_SLOTS, undefined)).toBeNull();
  });
});

/**
 * The snapshot-level projection over real sandbox content - the functions the view actually calls. The
 * key invariant: the highlight verdict (`computeAssignHighlight`, what the player sees green) and the click
 * resolver (`assignableJobForBuilding`, what a click binds) must agree building-for-building, so a green
 * building never silently cancels the click and a red one never binds. Both share one `candidateSlots`
 * gate; this proves they stay in lockstep over a live world.
 */
describe('computeAssignHighlight / assignableJobForBuilding over sandbox content', () => {
  it('highlights own candidate buildings and the green/red verdict matches what a click would bind', () => {
    const scene = getScene('sandbox');
    if (scene === undefined) throw new Error('sandbox scene missing');
    const sim = createSceneSim(scene);
    sim.step();
    const snapshot = sim.snapshot();
    const buildingsByType = lastByTypeId(sim.content.buildings);

    const settler = snapshot.entities.find(
      (e) => isSettler(e) && ownerPlayerOf(e) === HUMAN_PLAYER && settlerJobType(e) !== undefined,
    );
    if (settler === undefined) throw new Error('no employed owned settler in the sandbox');

    const items = computeAssignHighlight(snapshot, settler.id, buildingsByType);
    expect(items.length).toBeGreaterThan(0); // some own building employs someone

    // Lockstep: for every highlighted building, `ok` iff the click resolver would bind a job there.
    for (const item of items) {
      const job = assignableJobForBuilding(snapshot, item.id, settler.id, buildingsByType);
      expect(item.ok).toBe(job !== null);
    }
    // At least one candidate is green (the settler's trade has an open slot somewhere) and the resolver
    // returns a real job id for it.
    const green = items.find((i) => i.ok);
    expect(green).toBeDefined();
    expect(assignableJobForBuilding(snapshot, green?.id ?? -1, settler.id, buildingsByType)).not.toBeNull();

    // Every highlighted building is one the player owns (a candidate), never an enemy/neutral building.
    const byId = new Map(snapshot.entities.map((e) => [e.id, e]));
    for (const item of items) {
      const b = byId.get(item.id);
      expect(b !== undefined && isBuilding(b) && ownerPlayerOf(b) === HUMAN_PLAYER).toBe(true);
    }
  });
});

/**
 * The frame loop reads `highlight()` every RAF frame while the assign gesture is armed, but the pass it
 * runs is O(entities) (twice over, with the staffing map). It must therefore run once per snapshot, not
 * once per frame - while still re-colouring as soon as the world changes or another settler is armed.
 */
describe('pick-mode highlight cost', () => {
  function pickController(snapshot: () => WorldSnapshot, content: ContentSet): PickModeController {
    return createPickModeController({
      snapshot,
      targets: {
        owned: () => [],
        enemies: () => [],
        flags: () => [],
        signposts: () => [],
        ownedSettlersIn: () => [],
      },
      content,
      mapSize: { width: 8, height: 8 },
      toWorld: () => ({ x: 0, y: 0 }),
      enqueue: () => undefined,
      issueAttackMove: () => undefined,
      setArmedCursor: () => undefined,
    });
  }

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
    const pick = pickController(() => current, sim.content);

    pick.armWorkplace(settler.id);
    const frame = (): readonly BuildingHighlightItem[] | null => pick.highlight();
    const wash = frame();
    const afterFirst = first.scans();
    expect(afterFirst).toBeGreaterThan(0);
    expect(wash).toEqual(computeAssignHighlight(source, settler.id, buildingsByType));
    // The next frames reuse the memo: no rescan, and the very same array the renderer already holds.
    expect(frame()).toBe(wash);
    expect(frame()).toBe(wash);
    expect(first.scans()).toBe(afterFirst);

    // A new arm re-colours for the newly armed settler, on the same snapshot.
    pick.armWorkplace(other.id);
    expect(frame()).toEqual(computeAssignHighlight(source, other.id, buildingsByType));
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
