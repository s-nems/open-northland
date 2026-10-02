import type { ContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Equipment,
  type EquipmentSlot,
  MISC_EQUIP_SLOTS,
  PathFollow,
  wornSlot,
  writeEquipSlot,
} from '../../src/components/index.js';
import { type Fixed, fx, ONE, ULP, ZERO } from '../../src/core/fixed.js';
import { Rng } from '../../src/core/rng.js';
import type { Entity, World } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { wearStepOf, wearWornBoots, wearWornTool } from '../../src/systems/equipment/index.js';
import type { SystemContext } from '../../src/systems/index.js';
import { dropPath } from '../../src/systems/movement/nav-state.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';

// The boots' step wear a walk carries in its PathFollow against the record written on every step it
// replaces: one reference slot per fixture settler, worn exactly as the boots used to be, under the same
// walks, steps, hauls, pair swaps, take-offs and tool wear. Fixture goods: shoes 8 (10000 uses),
// tool_wooden 11.

const SHOES = 8;
const TOOL_WOODEN = 11;
const SETTLERS = 3;
const SPAN_STEPS = 40_000;
const SEED = 20_251_002;
/** A 40000-step differential against the per-step record: slow by design, and slower on a loaded machine. */
const DIFFERENTIAL_TIMEOUT_MS = 60_000;
/** A node's roughness ranges over 0 (no wear) to this. */
const MAX_ROUGHNESS = 3;
/** Roughly one pair swap, take-off and tool event per this many steps per settler. */
const SWAP_ODDS = 600;
const TAKE_OFF_ODDS = 2_500;
const TOOL_WEAR_ODDS = 40;
const TOOL_SWAP_ODDS = 900;
/** Roughly one walk start (while standing) and end (while walking) per this many steps per settler. */
const WALK_START_ODDS = 20;
const WALK_END_ODDS = 300;
/** A rating past the lossless whole-use range, so the boots wear by the fractional tool path. */
const FRACTIONAL_USES = 100_000;
const PERCENT = 100;

interface Reference {
  boots: EquipmentSlot | null;
  tool: EquipmentSlot | null;
}

function usesOf(content: ContentSet, goodType: number): number {
  const uses = content.goods.find((g) => g.typeId === goodType)?.equip?.uses;
  if (uses === undefined) throw new Error(`good ${goodType} has no rated uses`);
  return uses;
}

/** One step of the boots wear the overlay replaces, on the stored slot. */
function wearReferenceBoots(
  content: ContentSet,
  slot: EquipmentSlot | null,
  wear: number,
): EquipmentSlot | null {
  if (slot === null || slot.degreeOfUse >= ONE || wear === 0) return slot;
  const uses = usesOf(content, slot.goodType);
  if (uses > ONE / 2) return wearReferenceSlot(slot, fx.divCeil(fx.fromInt(wear), fx.fromInt(uses)));
  const half = fx.div(ONE, fx.fromInt(2));
  const spent = fx.toInt(fx.add(fx.mulDiv(slot.degreeOfUse, fx.fromInt(uses), ONE), half)) + wear;
  return spent >= uses
    ? null
    : { goodType: slot.goodType, degreeOfUse: fx.div(fx.fromInt(spent), fx.fromInt(uses)) };
}

function wearReferenceSlot(slot: EquipmentSlot | null, step: Fixed): EquipmentSlot | null {
  if (slot === null || step <= ZERO || slot.degreeOfUse >= ONE) return slot;
  const used = fx.add(slot.degreeOfUse, step);
  return used >= ONE ? null : { goodType: slot.goodType, degreeOfUse: used };
}

function equipmentRevision(world: World, e: Entity): number {
  let revision = -1;
  world.forEachComponent(e, (name, _value, at) => {
    if (name === Equipment.name) revision = at;
  });
  return revision;
}

function wearer(sim: Simulation): Entity {
  const e = sim.world.create();
  sim.world.add(e, Equipment, {
    boots: null,
    tool: null,
    weapon: null,
    armor: null,
    misc: new Array<EquipmentSlot | null>(MISC_EQUIP_SLOTS).fill(null),
  });
  return e;
}

function withShoeRating(content: ContentSet, uses: number): ContentSet {
  return {
    ...content,
    goods: content.goods.map((good) =>
      good.typeId === SHOES && good.equip !== undefined ? { ...good, equip: { ...good.equip, uses } } : good,
    ),
  };
}

function freshPair(rng: Rng): EquipmentSlot {
  const degrees = [ZERO, fx.div(fx.fromInt(rng.int(PERCENT)), fx.fromInt(PERCENT)), fx.sub(ONE, ULP)];
  return { goodType: SHOES, degreeOfUse: degrees[rng.int(degrees.length)] ?? ZERO };
}

function runSpan(content: ContentSet): { breaks: number; recordWrites: number; walkSteps: number } {
  const sim = new Simulation({ seed: 1, content });
  const ctx: SystemContext = { ...ctxOf(sim), content };
  const rng = new Rng(SEED);
  const settlers = Array.from({ length: SETTLERS }, () => wearer(sim));
  const refs = new Map<Entity, Reference>(settlers.map((e) => [e, { boots: null, tool: null }]));
  let breaks = 0;
  let recordWrites = 0;
  let walkSteps = 0;
  // Collected rather than asserted per step: a hundred thousand expect calls dominate the run.
  const mismatches: string[] = [];
  for (let i = 0; i < SPAN_STEPS; i++) {
    for (const e of settlers) {
      const ref = refs.get(e);
      if (ref === undefined) throw new Error('unreachable: every settler has a reference');
      const walking = sim.world.has(e, PathFollow);
      if (!walking && rng.int(WALK_START_ODDS) === 0) {
        sim.world.add(e, PathFollow, { index: 1, legElapsed: 0, legCost: 0 });
      }
      if (walking && rng.int(WALK_END_ODDS) === 0) {
        dropPath(sim.world, e);
        const stored = JSON.stringify(sim.world.get(e, Equipment).boots);
        if (stored !== JSON.stringify(ref.boots)) mismatches.push(`step ${i} entity ${e}: settled ${stored}`);
      }
      if (rng.int(SWAP_ODDS) === 0) {
        ref.boots = freshPair(rng);
        writeEquipSlot(sim.world, e, 'boots', 0, ref.boots);
      }
      if (rng.int(TAKE_OFF_ODDS) === 0) {
        ref.boots = null;
        writeEquipSlot(sim.world, e, 'boots', 0, null);
      }
      if (rng.int(TOOL_SWAP_ODDS) === 0) {
        ref.tool = { goodType: TOOL_WOODEN, degreeOfUse: ZERO };
        writeEquipSlot(sim.world, e, 'tool', 0, ref.tool);
      }
      if (rng.int(TOOL_WEAR_ODDS) === 0) {
        ref.tool = wearReferenceSlot(ref.tool, wearStepOf(ctx, TOOL_WOODEN));
        wearWornTool(sim.world, ctx, e);
      }
      const roughness = rng.int(MAX_ROUGHNESS + 1);
      const carrying = rng.int(2) === 0;
      const before = ref.boots;
      const revision = equipmentRevision(sim.world, e);
      ref.boots = wearReferenceBoots(content, before, carrying ? roughness * 2 : roughness);
      wearWornBoots(sim.world, ctx, e, roughness, carrying);
      if (before !== null && ref.boots === null) breaks++;
      if (sim.world.has(e, PathFollow)) walkSteps++;
      if (sim.world.has(e, PathFollow) && equipmentRevision(sim.world, e) !== revision) {
        recordWrites++;
        // Only a broken pair rewrites the record mid-walk; every other step keeps to the PathFollow.
        if (before === null || ref.boots !== null) mismatches.push(`step ${i} entity ${e}: record written`);
      }
      const boots = JSON.stringify(wornSlot(sim.world, e, 'boots', 0));
      if (boots !== JSON.stringify(ref.boots)) mismatches.push(`step ${i} entity ${e}: boots ${boots}`);
      const tool = JSON.stringify(sim.world.get(e, Equipment).tool);
      if (tool !== JSON.stringify(ref.tool)) mismatches.push(`step ${i} entity ${e}: tool ${tool}`);
    }
  }
  expect(mismatches.slice(0, 5)).toEqual([]);
  return { breaks, recordWrites, walkSteps };
}

describe('boots step wear carried by the walk', () => {
  it('wears and breaks every pair on the same step as the per-step record, writing it mid-walk only at a break', {
    timeout: DIFFERENTIAL_TIMEOUT_MS,
  }, () => {
    const { breaks, recordWrites, walkSteps } = runSpan(testContent());
    expect(recordWrites).toBeGreaterThan(0);
    expect(recordWrites).toBeLessThanOrEqual(breaks);
    expect(recordWrites).toBeLessThan(walkSteps / PERCENT);
  });

  it('matches the fractional wear of a rating beyond the whole-use range', {
    timeout: DIFFERENTIAL_TIMEOUT_MS,
  }, () => {
    const { breaks, recordWrites } = runSpan(withShoeRating(testContent(), FRACTIONAL_USES));
    expect(recordWrites).toBeGreaterThan(0);
    expect(recordWrites).toBeLessThanOrEqual(breaks);
  });
});
