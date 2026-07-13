import { describe, expect, it } from 'vitest';
import { Position, Settler, Stance } from '../../../src/components/index.js';
import { fx } from '../../../src/core/fixed.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import { spawnSettler } from '../../../src/systems/conflict/spawn/index.js';
import { setJob, setStance } from '../../../src/systems/orders/index.js';
import { defaultStanceForJob, MILITARY_MODE } from '../../../src/systems/readviews/index.js';
import { testContent } from '../../fixtures/content.js';
import { cell, combatant, ctxOf, grassMap, P0, VIKING, WOODCUTTER } from './support.js';

describe('stance defaults — the job → military-mode lookup', () => {
  it('classifies the roster: soldiers/heroes ATTACK, scout/hunter IGNORE, everyone else FLEE', () => {
    expect(defaultStanceForJob(31)).toBe(MILITARY_MODE.ATTACK); // first soldier
    expect(defaultStanceForJob(41)).toBe(MILITARY_MODE.ATTACK); // last soldier
    expect(defaultStanceForJob(45)).toBe(MILITARY_MODE.ATTACK); // a hero
    expect(defaultStanceForJob(27)).toBe(MILITARY_MODE.IGNORE); // scout
    expect(defaultStanceForJob(15)).toBe(MILITARY_MODE.IGNORE); // hunter (toward humans)
    expect(defaultStanceForJob(1)).toBe(MILITARY_MODE.FLEE); // woodcutter (civilian)
    expect(defaultStanceForJob(0)).toBe(MILITARY_MODE.FLEE); // idle
    expect(defaultStanceForJob(null)).toBe(MILITARY_MODE.FLEE); // jobless / child
  });

  it('stamps the job default on an OWNED settler at spawn — and NONE on an unowned one', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const ctx = ctxOf(sim);
    spawnSettler(sim.world, ctx, {
      kind: 'spawnSettler',
      jobType: WOODCUTTER,
      x: 0,
      y: 0,
      tribe: VIKING,
      owner: P0,
    });
    spawnSettler(sim.world, ctx, { kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 0, tribe: VIKING });
    const [owned, unowned] = [...sim.world.query(Settler)];
    expect(sim.world.get(owned as Entity, Stance).mode).toBe(MILITARY_MODE.FLEE); // owned civilian → FLEE
    expect(sim.world.has(unowned as Entity, Stance)).toBe(false); // unowned carries no Stance (golden-safe)
  });

  it('re-stamps the default on a profession change', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = combatant(sim, 0, 0, P0, MILITARY_MODE.ATTACK); // starts ATTACK
    setJob(sim.world, ctxOf(sim), { kind: 'setJob', entity: e, jobType: WOODCUTTER });
    expect(sim.world.get(e, Stance).mode).toBe(MILITARY_MODE.FLEE); // woodcutter default
  });
});

describe('setStance command', () => {
  it('sets an owned unit’s mode; a DEFEND stance captures the unit’s tile as the anchor', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 4) });
    const e = combatant(sim, 3, 2, P0, MILITARY_MODE.ATTACK);
    setStance(sim.world, ctxOf(sim), { kind: 'setStance', entity: e, mode: MILITARY_MODE.DEFEND });
    const s = sim.world.get(e, Stance);
    expect(s.mode).toBe(MILITARY_MODE.DEFEND);
    expect(s.anchorCell).toBe(cell(sim, 3, 2)); // anchored where it stood
  });

  it('clears the anchor when the mode is not DEFEND', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 4) });
    const e = combatant(sim, 3, 2, P0, MILITARY_MODE.DEFEND);
    sim.world.get(e, Stance).anchorCell = cell(sim, 3, 2);
    setStance(sim.world, ctxOf(sim), { kind: 'setStance', entity: e, mode: MILITARY_MODE.ATTACK });
    expect(sim.world.get(e, Stance).anchorCell).toBeNull();
  });

  it('skips a neutral (unowned) unit and an out-of-range mode (recoverable bad input)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    // Unowned: no Owner → the command is skipped (no Stance ever added).
    const neutral = sim.world.create();
    sim.world.add(neutral, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(neutral, Settler, {
      tribe: VIKING,
      jobType: WOODCUTTER,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map(),
    });
    setStance(sim.world, ctxOf(sim), { kind: 'setStance', entity: neutral, mode: MILITARY_MODE.ATTACK });
    expect(sim.world.has(neutral, Stance)).toBe(false);
    // Out-of-range mode on an owned unit: the mode is unchanged.
    const owned = combatant(sim, 1, 0, P0, MILITARY_MODE.IGNORE);
    setStance(sim.world, ctxOf(sim), { kind: 'setStance', entity: owned, mode: 7 });
    expect(sim.world.get(owned, Stance).mode).toBe(MILITARY_MODE.IGNORE);
  });
});
