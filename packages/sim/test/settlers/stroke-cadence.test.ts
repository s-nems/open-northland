import type { ContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AtomicClock,
  addCurrentAtomic,
  CurrentAtomic,
  DeferredOrder,
  Equipment,
  type EquipmentSlot,
  Felling,
  GroundDrop,
  HarvestFocus,
  MISC_EQUIP_SLOTS,
  MineDeposit,
  Position,
  Resource,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { cellAnchorNode, fx, Simulation } from '../../src/index.js';
import { wearStepOf } from '../../src/systems/equipment/index.js';
import { anchorOnlyFootprint, atomicSystem, stampResourceFootprintData } from '../../src/systems/index.js';
import { STROKE_REST_ATOMIC_IDS } from '../../src/systems/settlers/atomics/stroke-cadence.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

// Original behavior: a counted transform stroke (the chop) that leaves its node standing is followed by
// the same clip once more, landing and wearing nothing, then by one of the three short idle clips; only
// then does the gatherer pick its target and stance afresh. A split-up stroke (the chip) keeps the target,
// so the next clip starts at once from the same stance.

const VIKING = 1;
const WOODCUTTER = 1;
const WOOD = 1;
const CHOP_ATOMIC = 24;
const MINER = 5;
const STONE = 4;
const CHIP_ATOMIC = 25;
const TOOL_IRON = 12;
const TREE_YIELD = 4;
const DEPOSIT_SIZE = 3;
const DEPOSIT_LEVELS = testContent().goods.find((g) => g.id === 'stone')?.gathering?.depositLevels ?? 0;

/** The rest slots' clips, one length each so the slot drawn is readable off the atomic's duration. */
const REST_CLIPS = [
  { atomicId: 2, name: 'rest_short', length: 6 },
  { atomicId: 3, name: 'rest_medium', length: 12 },
  { atomicId: 4, name: 'rest_long', length: 24 },
] as const;

/** The fixture plus the woodcutter's three rest slots bound to clips of distinct lengths. */
function contentWithRestClips(): ContentSet {
  const base = testContent();
  return {
    ...base,
    tribes: base.tribes.map((t) =>
      t.typeId === VIKING
        ? {
            ...t,
            atomicBindings: [
              ...t.atomicBindings,
              ...REST_CLIPS.map((c) => ({ jobType: WOODCUTTER, atomicId: c.atomicId, animation: c.name })),
            ],
          }
        : t,
    ),
    atomicAnimations: [
      ...base.atomicAnimations,
      ...REST_CLIPS.map((c) => ({
        id: c.name,
        name: c.name,
        length: c.length,
        interruptible: true,
        events: [],
      })),
    ],
  };
}

function scene(seed: number, tool?: number): { sim: Simulation; cutter: Entity; tree: Entity; clip: number } {
  const sim = new Simulation({ seed, content: contentWithRestClips(), map: grassMap(4, 1) });
  const cutter = settlerAt(sim, { jobType: WOODCUTTER, position: { x: fx.fromInt(1), y: fx.fromInt(0) } });
  if (tool !== undefined) {
    sim.world.add(cutter, Equipment, {
      boots: null,
      tool: { goodType: tool, degreeOfUse: fx.fromInt(0) },
      weapon: null,
      armor: null,
      misc: new Array<EquipmentSlot | null>(MISC_EQUIP_SLOTS).fill(null),
    });
  }
  const tree = sim.world.create();
  sim.world.add(tree, Position, { x: fx.fromInt(1), y: fx.fromInt(0) });
  sim.world.add(tree, Resource, { goodType: WOOD, remaining: TREE_YIELD, harvestAtomic: CHOP_ATOMIC });
  stampResourceFootprintData(sim.world, tree, anchorOnlyFootprint());
  sim.world.add(tree, Felling, { chops: 0 });
  const clip = sim.content.atomicAnimations.find((a) => a.name === 'viking_chop')?.length ?? 0;
  expect(clip).toBeGreaterThan(0);
  return { sim, cutter, tree, clip };
}

function startChop(sim: Simulation, cutter: Entity, tree: Entity, clip: number): void {
  addCurrentAtomic(sim.world, cutter, {
    atomicId: CHOP_ATOMIC,
    duration: clip,
    effect: { kind: 'harvest', resource: tree, goodType: WOOD },
    targetEntity: tree,
    targetTile: null,
  });
}

function run(sim: Simulation, ticks: number): void {
  for (let t = 0; t < ticks; t++) atomicSystem(sim.world, ctxOf(sim));
}

describe('stroke cadence - what follows a counted stroke that leaves the node standing', () => {
  it('replays the clip as a follow-through that lands nothing and wears nothing, remembering the node', () => {
    const { sim, cutter, tree, clip } = scene(1, TOOL_IRON);
    const step = wearStepOf(ctxOf(sim), TOOL_IRON);
    startChop(sim, cutter, tree, clip);

    run(sim, clip); // the counted stroke
    expect(sim.world.get(tree, Felling).chops).toBe(1);
    expect(sim.world.get(cutter, Equipment).tool?.degreeOfUse).toBe(step);
    const followThrough = sim.world.get(cutter, CurrentAtomic);
    expect(followThrough.effect.kind).toBe('harvestFollowThrough');
    expect(followThrough.atomicId).toBe(CHOP_ATOMIC);
    expect(followThrough.duration).toBe(clip);
    expect(sim.world.get(cutter, AtomicClock).elapsed).toBe(0);
    expect(sim.world.get(cutter, HarvestFocus).node).toBe(tree);

    run(sim, clip); // the follow-through
    expect(sim.world.get(tree, Felling).chops).toBe(1);
    expect(sim.world.get(cutter, Equipment).tool?.degreeOfUse).toBe(step);
  });

  it("then rests on one of the three short idle slots for that clip's length, and is released after it", () => {
    const { sim, cutter, tree, clip } = scene(1);
    startChop(sim, cutter, tree, clip);
    run(sim, 2 * clip);

    const rest = sim.world.get(cutter, CurrentAtomic);
    expect(rest.effect.kind).toBe('idle');
    expect(STROKE_REST_ATOMIC_IDS).toContain(rest.atomicId);
    const bound = REST_CLIPS.find((c) => c.atomicId === rest.atomicId);
    expect(rest.duration).toBe(bound?.length);
    expect(rest.targetEntity).toBeNull();

    run(sim, rest.duration);
    expect(sim.world.has(cutter, CurrentAtomic)).toBe(false);
    expect(sim.world.get(cutter, HarvestFocus).node).toBe(tree); // the next plan returns to it
  });

  it('draws the rest slot from the sim stream: every slot turns up over seeds, none outside the three', () => {
    const slots = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      const { sim, cutter, tree, clip } = scene(seed);
      startChop(sim, cutter, tree, clip);
      run(sim, 2 * clip);
      slots.add(sim.world.get(cutter, CurrentAtomic).atomicId);
    }
    expect([...slots].every((id) => STROKE_REST_ATOMIC_IDS.includes(id))).toBe(true);
    expect(slots.size).toBeGreaterThan(1);
  });

  it('the stroke that fells the tree releases the cutter at once, with nothing to return to', () => {
    const { sim, cutter, tree, clip } = scene(1);
    const needed =
      testContent().jobExperience.find((t) => t.id === 'woodcutter_wood')?.baseRepeatCounter ?? 0;
    sim.world.mut(tree, Felling).chops = needed - 1;
    sim.world.add(cutter, HarvestFocus, { node: tree });
    startChop(sim, cutter, tree, clip);
    run(sim, clip);
    expect(sim.world.has(tree, Resource)).toBe(false);
    expect([...sim.world.query(GroundDrop)]).toHaveLength(1);
    expect(sim.world.has(cutter, CurrentAtomic)).toBe(false);
    expect(sim.world.has(cutter, HarvestFocus)).toBe(false);
  });

  it('a parked order releases the cutter at the follow-through boundary, skipping the rest', () => {
    const { sim, cutter, tree, clip } = scene(1);
    startChop(sim, cutter, tree, clip);
    run(sim, clip);
    sim.world.add(cutter, DeferredOrder, { command: { kind: 'moveUnit', entity: cutter, x: 0, y: 0 } });
    run(sim, clip);
    expect(sim.world.has(cutter, CurrentAtomic)).toBe(false);
    expect(sim.world.get(tree, Felling).chops).toBe(1);
    expect(sim.world.get(cutter, HarvestFocus).node).toBe(tree); // the part-worked node is still remembered
  });

  it('a parked order at the counted stroke releases at once, the node still remembered', () => {
    const { sim, cutter, tree, clip } = scene(1);
    startChop(sim, cutter, tree, clip);
    sim.world.add(cutter, DeferredOrder, { command: { kind: 'moveUnit', entity: cutter, x: 0, y: 0 } });
    run(sim, clip);
    expect(sim.world.has(cutter, CurrentAtomic)).toBe(false);
    expect(sim.world.get(tree, Felling).chops).toBe(1);
    expect(sim.world.get(cutter, HarvestFocus).node).toBe(tree);
  });
});

describe('stroke cadence - a split-up stroke that leaves the deposit standing', () => {
  function depositScene(seed: number): { sim: Simulation; miner: Entity; deposit: Entity; clip: number } {
    const sim = new Simulation({ seed, content: contentWithRestClips(), map: grassMap(4, 1) });
    const miner = settlerAt(sim, { jobType: MINER, position: { x: fx.fromInt(1), y: fx.fromInt(0) } });
    sim.world.add(miner, Equipment, {
      boots: null,
      tool: { goodType: TOOL_IRON, degreeOfUse: fx.fromInt(0) },
      weapon: null,
      armor: null,
      misc: new Array<EquipmentSlot | null>(MISC_EQUIP_SLOTS).fill(null),
    });
    const deposit = sim.world.create();
    sim.world.add(deposit, Position, { x: fx.fromInt(2), y: fx.fromInt(0) });
    sim.world.add(deposit, Resource, {
      goodType: STONE,
      remaining: DEPOSIT_SIZE,
      harvestAtomic: CHIP_ATOMIC,
    });
    stampResourceFootprintData(sim.world, deposit, anchorOnlyFootprint());
    sim.world.add(deposit, MineDeposit, { initial: DEPOSIT_SIZE, levels: DEPOSIT_LEVELS, strikes: 0 });
    const clip = sim.content.atomicAnimations.find((a) => a.name === 'viking_mine')?.length ?? 0;
    expect(clip).toBeGreaterThan(0);
    return { sim, miner, deposit, clip };
  }

  /** The terrain node under the miner's tile (1,0): the stance its chips are struck from. */
  function minerNode(sim: Simulation): number {
    if (sim.terrain === undefined) throw new Error('the scene has a map');
    const { hx, hy } = cellAnchorNode(1, 0);
    return sim.terrain.nodeAt(hx, hy);
  }

  function startChip(sim: Simulation, miner: Entity, deposit: Entity, clip: number): void {
    addCurrentAtomic(sim.world, miner, {
      atomicId: CHIP_ATOMIC,
      duration: clip,
      effect: { kind: 'harvest', resource: deposit, goodType: STONE },
      targetEntity: deposit,
      targetTile: null,
    });
  }

  it('releases the miner at once, holding the deposit and the stance the chip was struck from', () => {
    const { sim, miner, deposit, clip } = depositScene(1);
    const step = wearStepOf(ctxOf(sim), TOOL_IRON);
    startChip(sim, miner, deposit, clip);

    run(sim, clip);
    expect(sim.world.get(deposit, MineDeposit).strikes).toBe(1);
    expect(sim.world.get(miner, Equipment).tool?.degreeOfUse).toBe(step);
    expect(sim.world.has(miner, CurrentAtomic)).toBe(false);
    const focus = sim.world.get(miner, HarvestFocus);
    expect(focus.node).toBe(deposit);
    expect(focus.stance).toBe(minerNode(sim));
  });

  it('a parked order releases the miner the same way, the deposit and stance still held', () => {
    const { sim, miner, deposit, clip } = depositScene(1);
    startChip(sim, miner, deposit, clip);
    sim.world.add(miner, DeferredOrder, { command: { kind: 'moveUnit', entity: miner, x: 0, y: 0 } });
    run(sim, clip);
    expect(sim.world.has(miner, CurrentAtomic)).toBe(false);
    expect(sim.world.get(deposit, MineDeposit).strikes).toBe(1);
    expect(sim.world.get(miner, HarvestFocus)).toEqual({
      node: deposit,
      stance: minerNode(sim),
    });
  });
});
