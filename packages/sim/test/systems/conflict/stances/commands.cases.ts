import { type ContentSet, parseContentSet, WERESNAKE_TRIBE, WEREWOLF_TRIBE } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Health,
  MISSION_BEHAVIOUR,
  Position,
  Settler,
  Stance,
} from '../../../../src/components/index.js';
import { fx } from '../../../../src/core/fixed.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { Simulation } from '../../../../src/index.js';
import { setAiControl } from '../../../../src/systems/orders/ai.js';
import { setJob, setStance } from '../../../../src/systems/orders/index.js';
import { defaultStance, MILITARY_MODE } from '../../../../src/systems/readviews/index.js';
import { spawnSettler } from '../../../../src/systems/spawn/index.js';
import { testContent } from '../../../fixtures/content.js';
import { cell, combatant, ctxOf, grassMap, P0, VIKING, WOODCUTTER } from './support.js';

const DRAGON_TRIBE = 42;
const DRAGON_HITPOINTS = 20000;

/** The fixture plus the monster tribes with the rules the app stamps on them. */
function monsterContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    tribes: [
      ...base.tribes,
      { typeId: WERESNAKE_TRIBE, id: 'weresnake', monster: { startsInAttack: true } },
      { typeId: WEREWOLF_TRIBE, id: 'werewolf', monster: { startsInAttack: true } },
      { typeId: DRAGON_TRIBE, id: 'dragon', monster: { hitpoints: DRAGON_HITPOINTS } },
    ],
  });
}

describe('stance defaults - the job → military-mode lookup', () => {
  const SOLDIER = 31; // soldier_unarmed
  const CLOSED_SEAT = { kind: 'setAiControl', player: P0, enabled: true, computerEnabled: false } as const;

  /** An owned settler of `tribe` in `jobType` at node (x, 0). */
  function spawn(sim: Simulation, jobType: number, tribe = VIKING, behaviourFlags?: number, x = 0): Entity {
    const e = spawnSettler(sim.world, ctxOf(sim), {
      kind: 'spawnSettler',
      jobType,
      x,
      y: 0,
      tribe,
      owner: P0,
      ...(behaviourFlags === undefined ? {} : { behaviourFlags }),
    });
    if (e === null) throw new Error('spawn refused');
    return e;
  }

  function spawnedStance(jobType: number, tribe = VIKING, behaviourFlags?: number): number {
    const content = tribe === VIKING ? testContent() : monsterContent();
    const sim = new Simulation({ seed: 1, content, map: grassMap(4, 1) });
    return sim.world.get(spawn(sim, jobType, tribe, behaviourFlags), Stance).mode;
  }

  it('classifies the roster: soldiers/heroes DEFEND, everyone else IGNORE', () => {
    expect(spawnedStance(SOLDIER)).toBe(MILITARY_MODE.DEFEND);
    expect(spawnedStance(45)).toBe(MILITARY_MODE.DEFEND); // hero_saber
    expect(spawnedStance(27)).toBe(MILITARY_MODE.IGNORE); // scout
    expect(spawnedStance(15)).toBe(MILITARY_MODE.IGNORE); // hunter (toward humans)
    expect(spawnedStance(WOODCUTTER)).toBe(MILITARY_MODE.IGNORE); // civilian
    expect(spawnedStance(0)).toBe(MILITARY_MODE.IGNORE); // idle
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = spawn(sim, WOODCUTTER);
    expect(defaultStance(sim.world, sim.content, e, null)).toBe(MILITARY_MODE.IGNORE); // jobless / child
    // A job id this content declares no record for is a civilian, not a fighter by numeric band.
    expect(defaultStance(sim.world, sim.content, e, 41)).toBe(MILITARY_MODE.IGNORE);
  });

  it('starts a weresnake or werewolf fighter in ATTACK unless its behaviour bit asks for DEFEND', () => {
    expect(spawnedStance(SOLDIER, WERESNAKE_TRIBE)).toBe(MILITARY_MODE.ATTACK);
    expect(spawnedStance(SOLDIER, WEREWOLF_TRIBE)).toBe(MILITARY_MODE.ATTACK);
    expect(spawnedStance(SOLDIER, WERESNAKE_TRIBE, MISSION_BEHAVIOUR.SPAWNS_DEFENDING)).toBe(
      MILITARY_MODE.DEFEND,
    );
  });

  it('starts a dragon in DEFEND with its own hitpoint pool', () => {
    expect(spawnedStance(SOLDIER, DRAGON_TRIBE)).toBe(MILITARY_MODE.DEFEND);
    const sim = new Simulation({ seed: 1, content: monsterContent(), map: grassMap(4, 1) });
    expect(sim.world.get(spawn(sim, SOLDIER, DRAGON_TRIBE), Health)).toEqual({
      hitpoints: DRAGON_HITPOINTS,
      max: DRAGON_HITPOINTS,
    });
  });

  it('starts the fighters of a seat the computer does not command in DEFEND', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    setAiControl(sim.world, ctxOf(sim), CLOSED_SEAT);
    expect(sim.world.get(spawn(sim, SOLDIER), Stance).mode).toBe(MILITARY_MODE.DEFEND);
    expect(sim.world.get(spawn(sim, WOODCUTTER, VIKING, undefined, 2), Stance).mode).toBe(
      MILITARY_MODE.IGNORE,
    );
  });

  it('stands a seat’s placed fighters down to DEFEND at their places once the seat is closed', () => {
    const sim = new Simulation({ seed: 1, content: monsterContent(), map: grassMap(8, 1) });
    const soldier = spawn(sim, SOLDIER, VIKING, undefined, 2);
    const weresnake = spawn(sim, SOLDIER, WERESNAKE_TRIBE, undefined, 4);
    setAiControl(sim.world, ctxOf(sim), CLOSED_SEAT);
    expect(sim.world.get(soldier, Stance)).toEqual({
      mode: MILITARY_MODE.DEFEND,
      anchorCell: sim.terrain?.nodeAtClamped(2, 0), // the spawn's own node
    });
    expect(sim.world.get(weresnake, Stance).mode).toBe(MILITARY_MODE.ATTACK);
  });

  it('keeps an attack the map AI ordered when the closed seat is set again', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const soldier = spawn(sim, SOLDIER);
    setAiControl(sim.world, ctxOf(sim), CLOSED_SEAT);
    setStance(sim.world, ctxOf(sim), { kind: 'setStance', entity: soldier, mode: MILITARY_MODE.ATTACK });
    setAiControl(sim.world, ctxOf(sim), CLOSED_SEAT);
    expect(sim.world.get(soldier, Stance).mode).toBe(MILITARY_MODE.ATTACK);
  });

  it('stands the fighters down when the computer stops commanding the seat', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const soldier = spawn(sim, SOLDIER);
    setAiControl(sim.world, ctxOf(sim), { kind: 'setAiControl', player: P0, enabled: true });
    setStance(sim.world, ctxOf(sim), { kind: 'setStance', entity: soldier, mode: MILITARY_MODE.ATTACK });
    expect(sim.world.get(soldier, Stance).mode).toBe(MILITARY_MODE.ATTACK);
    setAiControl(sim.world, ctxOf(sim), {
      kind: 'setAiControl',
      player: P0,
      enabled: true,
      modules: { military: false },
    });
    expect(sim.world.get(soldier, Stance).mode).toBe(MILITARY_MODE.DEFEND);
  });

  it('starts the computer player’s fighters in DEFEND like every other human', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    setAiControl(sim.world, ctxOf(sim), { kind: 'setAiControl', player: P0, enabled: true });
    expect(sim.world.get(spawn(sim, SOLDIER), Stance).mode).toBe(MILITARY_MODE.DEFEND);
  });

  it('stamps the job default on an OWNED settler at spawn - and NONE on an unowned one', () => {
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
    expect(sim.world.get(owned as Entity, Stance).mode).toBe(MILITARY_MODE.IGNORE); // owned civilian → IGNORE
    expect(sim.world.has(unowned as Entity, Stance)).toBe(false); // unowned carries no Stance (golden-safe)
  });

  it('re-stamps the default on a profession change', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = combatant(sim, 0, 0, P0, MILITARY_MODE.ATTACK); // starts ATTACK
    setJob(sim.world, ctxOf(sim), { kind: 'setJob', entity: e, jobType: WOODCUTTER });
    expect(sim.world.get(e, Stance).mode).toBe(MILITARY_MODE.IGNORE); // woodcutter default
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

  it('clears the anchor of a civilian set to a mode that keeps none', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 4) });
    const e = combatant(sim, 3, 2, P0, MILITARY_MODE.DEFEND);
    sim.world.mut(e, Stance).anchorCell = cell(sim, 3, 2);
    setStance(sim.world, ctxOf(sim), { kind: 'setStance', entity: e, mode: MILITARY_MODE.ATTACK });
    expect(sim.world.get(e, Stance).anchorCell).toBeNull();
  });

  it('skips a neutral (unowned) unit and an out-of-range mode (recoverable bad input)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    // Unowned: no Owner → the command is skipped (no Stance ever added).
    const neutral = sim.world.create();
    sim.world.add(neutral, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    addPerson(sim.world, neutral, {
      tribe: VIKING,
      jobType: WOODCUTTER,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
    });
    setStance(sim.world, ctxOf(sim), { kind: 'setStance', entity: neutral, mode: MILITARY_MODE.ATTACK });
    expect(sim.world.has(neutral, Stance)).toBe(false);
    // Out-of-range mode on an owned unit: the mode is unchanged.
    const owned = combatant(sim, 1, 0, P0, MILITARY_MODE.IGNORE);
    setStance(sim.world, ctxOf(sim), { kind: 'setStance', entity: owned, mode: 7 });
    expect(sim.world.get(owned, Stance).mode).toBe(MILITARY_MODE.IGNORE);
  });
});
