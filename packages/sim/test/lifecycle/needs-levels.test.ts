import { describe, expect, it } from 'vitest';
import {
  Age,
  Health,
  type NeedLevels,
  Position,
  Rider,
  SettlerNeeds,
  setSettlerJob,
} from '../../src/components/index.js';
import { Rng } from '../../src/core/rng.js';
import type { Entity } from '../../src/ecs/world.js';
import { type Fixed, fx, ONE, Simulation } from '../../src/index.js';
import {
  applyNeedUnits,
  clampNeed,
  mutNeeds,
  NEED_BAND_THRESHOLDS,
  NEED_DRAIN_UNITS_PER_TICK,
  NEED_SATED_THRESHOLD,
  needBar,
  needLevel,
  needLevels,
  needsSystem,
  REGENERATION_HITPOINTS_PER_TICK,
  STARVATION_HITPOINTS_PER_TICK,
} from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { fixtureTick, nextTickCtxOf } from '../fixtures/context.js';
import { needsOf, settlerAt } from '../fixtures/settler.js';

// The stored-and-derived needs against the per-tick drain they replace: one reference settler per
// fixture settler, drained one clamped step per pass exactly as the bars used to be, under the same
// meals, rests, chats, work costs, AI settles and drain changes, written before and after the pass.

const WOODCUTTER = 1;
/** A soldier trade (jobtypes.ini soldiers 31..41): hunger and fatigue drain, company does not. */
const SOLDIER = 31;
const SETTLERS = 3;
const SPAN_TICKS = 60_000;
/** Roughly one bar event per this many ticks per settler. */
const EVENT_ODDS = 1000;
/** Roughly one drain change per this many ticks per settler. */
const GATE_ODDS = 3_000;
/** A pool no starvation in the span can empty, so hitpoints keep moving the whole run. */
const POOL = 1_000_000;
const SEED = 20_251_001;
/** A stretch of passes far short of any band threshold. */
const DRAINED_TICKS = 50;

const DRAINING = ['hunger', 'fatigue', 'enjoyment'] as const;
const THRESHOLDS: readonly Fixed[] = NEED_BAND_THRESHOLDS;

type Gate = 'trade' | 'fighter' | 'growing';

/** The reserve-unit moves the events apply, the data's own sign: positive serves a bar. */
const EVENTS: readonly { readonly need: keyof NeedLevels; readonly units: number }[] = [
  { need: 'hunger', units: 4000 },
  { need: 'fatigue', units: 3000 },
  { need: 'enjoyment', units: 2500 },
  { need: 'piety', units: 800 },
  { need: 'hunger', units: -100 },
  { need: 'fatigue', units: -100 },
  { need: 'enjoyment', units: -100 },
];

interface Reference {
  levels: NeedLevels;
  gate: Gate;
  hitpoints: number;
}

const DRAIN_STEP = needBar(-NEED_DRAIN_UNITS_PER_TICK);

/** One tick of the per-tick drain the stored form replaces. */
function drainReference(ref: Reference): void {
  if (ref.gate === 'growing') return;
  const drain = (level: Fixed): Fixed => clampNeed(fx.sub(level, DRAIN_STEP));
  ref.levels.hunger = drain(ref.levels.hunger);
  ref.levels.fatigue = drain(ref.levels.fatigue);
  if (ref.gate === 'trade') ref.levels.enjoyment = drain(ref.levels.enjoyment);
}

function stepReferenceHealth(ref: Reference): void {
  if (ref.gate !== 'growing' && ref.levels.hunger === ONE) ref.hitpoints -= STARVATION_HITPOINTS_PER_TICK;
  else if (ref.hitpoints < POOL)
    ref.hitpoints = Math.min(POOL, ref.hitpoints + REGENERATION_HITPOINTS_PER_TICK);
}

function setGate(sim: Simulation, e: Entity, gate: Gate): void {
  setSettlerJob(sim.world, e, gate === 'fighter' ? SOLDIER : WOODCUTTER);
  if (gate === 'growing') sim.world.add(e, Age, { ticks: 0 });
  else if (sim.world.has(e, Age)) sim.world.remove(e, Age);
}

/** Apply one event to both forms; `drainedThrough` is the tick whose pass the bars include. */
function applyEvent(sim: Simulation, e: Entity, ref: Reference, rng: Rng, drainedThrough: number): void {
  const pick = rng.int(EVENTS.length + 1);
  const s = mutNeeds(sim.world, e, drainedThrough);
  if (pick === EVENTS.length) {
    // A computer seat's failed seek: the bar goes back to the sated level.
    const need = DRAINING[rng.int(DRAINING.length)] ?? 'hunger';
    s[need] = NEED_SATED_THRESHOLD;
    ref.levels[need] = NEED_SATED_THRESHOLD;
    return;
  }
  const event = EVENTS[pick];
  if (event === undefined) throw new Error('event pick out of range');
  s[event.need] = applyNeedUnits(s[event.need], event.units);
  ref.levels[event.need] = applyNeedUnits(ref.levels[event.need], event.units);
}

/** The ticks at which each bar reached or left each threshold, as `tick:need:threshold:side`. */
function crossings(log: string[], tick: number, need: string, before: Fixed, after: Fixed): void {
  for (const threshold of THRESHOLDS) {
    if (before >= threshold !== after >= threshold)
      log.push(`${tick}:${need}:${threshold}:${after >= threshold}`);
  }
}

describe('needs stored as level-at-tick', () => {
  it('derives every bar, threshold crossing and starvation bite the per-tick drain produced', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const rng = new Rng(SEED);
    const settlers: Entity[] = [];
    const references: Reference[] = [];
    for (let i = 0; i < SETTLERS; i++) {
      const start = needBar(rng.int(5000));
      const e = settlerAt(sim, {
        jobType: WOODCUTTER,
        needs: { hunger: start, fatigue: start, enjoyment: start },
      });
      sim.world.add(e, Health, { hitpoints: POOL, max: POOL });
      settlers.push(e);
      references.push({
        levels: { ...needLevels(sim.world.get(e, SettlerNeeds), 0) },
        gate: 'trade',
        hitpoints: POOL,
      });
    }
    const derivedCrossings: string[] = [];
    const referenceCrossings: string[] = [];
    let starvedTicks = 0;
    const writesBefore = sim.world.componentValueGeneration(SettlerNeeds);

    for (let step = 0; step < SPAN_TICKS; step++) {
      const ctx = nextTickCtxOf(sim);
      const tick = ctx.tick;
      settlers.forEach((e, i) => {
        const ref = references[i];
        if (ref === undefined) throw new Error('reference missing');
        // Before the pass, as a command lands: the bars stand at the previous tick.
        if (rng.int(EVENT_ODDS * 2) === 0) applyEvent(sim, e, ref, rng, tick - 1);
        if (rng.int(GATE_ODDS) === 0) {
          const gates: readonly Gate[] = ['trade', 'fighter', 'growing'];
          ref.gate = gates[rng.int(gates.length)] ?? 'trade';
          setGate(sim, e, ref.gate);
        }
      });
      const before = settlers.map((e) => needLevels(sim.world.get(e, SettlerNeeds), tick - 1));
      needsSystem(sim.world, ctx);
      settlers.forEach((e, i) => {
        const ref = references[i];
        const was = before[i];
        if (ref === undefined || was === undefined) throw new Error('reference missing');
        const refBefore = { ...ref.levels };
        drainReference(ref);
        stepReferenceHealth(ref);
        if (ref.gate !== 'growing' && ref.levels.hunger === ONE) starvedTicks++;
        // After the pass, as a clip event lands.
        if (rng.int(EVENT_ODDS * 2) === 0) applyEvent(sim, e, ref, rng, tick);

        const stored = sim.world.get(e, SettlerNeeds);
        const derived = needLevels(stored, fixtureTick(sim));
        expect(derived).toEqual(ref.levels);
        expect(sim.world.get(e, Health).hitpoints).toBe(ref.hitpoints);
        for (const need of DRAINING) {
          crossings(derivedCrossings, tick, need, was[need], derived[need]);
          crossings(referenceCrossings, tick, need, refBefore[need], ref.levels[need]);
          // The stored bar sits on the same side of every band threshold as the bar it derives to.
          for (const threshold of THRESHOLDS)
            expect(stored[need] >= threshold).toBe(derived[need] >= threshold);
        }
      });
    }

    expect(derivedCrossings).toEqual(referenceCrossings);
    expect(derivedCrossings.length).toBeGreaterThan(SETTLERS * THRESHOLDS.length);
    expect(starvedTicks).toBeGreaterThan(0);
    // The point of the form: far fewer writes than passes.
    const writes = sim.world.componentValueGeneration(SettlerNeeds) - writesBefore;
    expect(writes).toBeLessThan((SPAN_TICKS * SETTLERS) / 10);
  });

  it('reads a bar unchanged before its stored tick and pinned at ONE after', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerAt(sim, { jobType: WOODCUTTER, needs: { hunger: fx.sub(ONE, needBar(1)) } });
    needsSystem(sim.world, nextTickCtxOf(sim));
    const stored = sim.world.get(e, SettlerNeeds);
    expect(needLevel(stored, 'hunger', stored.asOf - 1)).toBe(stored.hunger);
    expect(needLevel(stored, 'hunger', stored.asOf + SPAN_TICKS)).toBe(ONE);
  });
  it('holds the bars from the tick needs are switched off and drains again once they are back on', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerAt(sim, { jobType: WOODCUTTER });
    sim.run(DRAINED_TICKS);
    const held = needsOf(sim, e);
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    sim.run(DRAINED_TICKS);
    expect(needsOf(sim, e)).toEqual(held);
    expect(sim.world.get(e, SettlerNeeds).drain).toBe('none');
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: true });
    sim.step();
    expect(needsOf(sim, e).hunger).toBe(fx.sub(held.hunger, DRAIN_STEP));
  });

  it('holds a draining settler’s bars aboard a cart and drains them again once it steps off', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerAt(sim, { jobType: WOODCUTTER, position: { x: fx.fromInt(0), y: fx.fromInt(0) } });
    for (let i = 0; i < DRAINED_TICKS; i++) needsSystem(sim.world, nextTickCtxOf(sim));
    const held = needsOf(sim, e);
    // Aboard and off the map, on a vehicle that is no ship.
    sim.world.remove(e, Position);
    sim.world.add(e, Rider, { vehicle: sim.world.create(), boarding: false });
    for (let i = 0; i < DRAINED_TICKS; i++) needsSystem(sim.world, nextTickCtxOf(sim));
    expect(needsOf(sim, e)).toEqual(held);
    sim.world.remove(e, Rider);
    sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    needsSystem(sim.world, nextTickCtxOf(sim));
    expect(needsOf(sim, e).hunger).toBe(fx.sub(held.hunger, DRAIN_STEP));
  });
});
