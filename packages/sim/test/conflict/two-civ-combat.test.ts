import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { CurrentAtomic, Health, Position, Settler } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  type Fixed,
  fx,
  halfCellMapFromCells,
  positionOfNode,
  Simulation,
  type TerrainMap,
} from '../../src/index.js';
import { isPlayableTribe, mayAttack } from '../../src/systems/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';

/**
 * Two fully-defined playable civilizations fighting through the real `Simulation.step()` schedule,
 * each resolving its own asymmetric weapon + attack-animation binding — the integration
 * `playable-tribes.test.ts` (pure `mayAttack` predicate) and `combat-system.test.ts` (one tribe, direct
 * `combatSystem()` call) leave uncovered.
 *
 * The asymmetry is entirely in the data, never a hardcoded "two": the tribes differ only in their
 * per-tribe rows (each its own `jobEnables` edge, `weapontypes` damage/reach, and `setatomic 81 ->
 * attack animation` whose `length` is its swing duration), and the sim resolves every per-tribe rule off
 * `settler.tribe`. An N-tribe set is the same shape with more rows.
 *
 * Combatants are placed directly: a civ becomes a combatant only once it carries a `Health` pool, and
 * settler-side Health stamping is a separate slice (as in populated-map-combat.test.ts).
 */

const VIKING = 1;
const SAXON = 2;
const SOLDIER = 1; // job 1 — each tribe binds its attack weapon + atomic 81 to job 1

/**
 * Two PLAYABLE civilizations with deliberately **asymmetric** combat data:
 *  - viking (tribe 1): `viking_mace` — damage 50 vs unarmored, reach 2, attack animation length 4.
 *  - saxon  (tribe 2): `saxon_sword` — damage 30 vs unarmored, reach 3, attack animation length 6.
 * Both carry a `jobEnables` tech-graph edge (so each is a civilization, `isPlayableTribe` true) — a
 * different edge kind each, to underline that the asymmetry is just data, not a special case.
 */
function twoCivContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: 3, id: 'coin' }, // the good the saxon tech edge unlocks
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: 1, id: 'soldier' },
    ],
    buildings: [
      { typeId: 1, id: 'headquarters', kind: 'headquarters' },
      { typeId: 4, id: 'home', kind: 'home' }, // the building the viking tech edge unlocks
    ],
    landscape: [{ typeId: 0, id: 'grass', walkable: true, buildable: true }],
    weapons: [
      // viking soldier (tribe 1, job 1): a hard-hitting short-reach mace.
      {
        typeId: 7,
        id: 'viking_mace',
        tribeType: VIKING,
        jobType: SOLDIER,
        minRange: 1,
        maxRange: 2,
        damage: { '0': 50 },
      },
      // saxon soldier (tribe 2, job 1): a weaker but longer-reach sword — asymmetric on BOTH axes.
      {
        typeId: 8,
        id: 'saxon_sword',
        tribeType: SAXON,
        jobType: SOLDIER,
        minRange: 1,
        maxRange: 3,
        damage: { '0': 30 },
      },
    ],
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        // attack atomic 81 -> viking_attack (length 4): the viking's swing duration.
        atomicBindings: [{ jobType: SOLDIER, atomicId: 81, animation: 'viking_attack' }],
        // a `house` tech edge — a civilization (so isPlayableTribe is true).
        jobEnables: [{ jobType: SOLDIER, kind: 'house', targetId: 4 }],
      },
      {
        typeId: SAXON,
        id: 'saxon',
        // attack atomic 81 -> saxon_attack (length 6): a DIFFERENT swing duration than the viking's.
        atomicBindings: [{ jobType: SOLDIER, atomicId: 81, animation: 'saxon_attack' }],
        // a `good` tech edge (a different kind than the viking's) — also a civilization.
        jobEnables: [{ jobType: SOLDIER, kind: 'good', targetId: 3 }],
      },
    ],
    atomicAnimations: [
      { id: 'viking_attack', name: 'viking_attack', length: 4 },
      { id: 'saxon_attack', name: 'saxon_attack', length: 6 },
    ],
  });
}

/** An all-grass (fully walkable) w×h-cell terrain map, upsampled to the half-cell lattice. */
function grass(width: number, height: number): TerrainMap {
  return halfCellMapFromCells({ width, height, typeIds: new Array(width * height).fill(0) });
}

/** Place a civilization combatant (a settler with a Health pool) of `tribe` at visual cell (x,y). */
function fighterAt(sim: Simulation, x: number, y: number, tribe: number, hitpoints: number): Entity {
  return fighterAtPosition(sim, { x: fx.fromInt(x), y: fx.fromInt(y) }, tribe, hitpoints);
}

/** A combatant standing exactly on half-cell node (hx, hy) — reach geometry a whole cell (2 nodes on a
 *  row) cannot express, e.g. an ODD node distance from a cell-anchored fighter. */
function fighterAtNode(sim: Simulation, hx: number, hy: number, tribe: number, hitpoints: number): Entity {
  return fighterAtPosition(sim, positionOfNode(hx, hy), tribe, hitpoints);
}

function fighterAtPosition(
  sim: Simulation,
  position: { x: Fixed; y: Fixed },
  tribe: number,
  hitpoints: number,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: position.x, y: position.y });
  sim.world.add(e, Settler, {
    tribe,
    jobType: SOLDIER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Health, { hitpoints, max: hitpoints });
  return e;
}

describe('two-civ combat scenario (two playable tribes, asymmetric bindings, end-to-end)', () => {
  it('recognizes BOTH tribes as playable civilizations by their tech graph alone', () => {
    const content = twoCivContent();
    expect(isPlayableTribe(content, VIKING)).toBe(true);
    expect(isPlayableTribe(content, SAXON)).toBe(true);
    // And the PvP hostility relation holds in both directions (the drive the scenario runs).
    expect(mayAttack(content, VIKING, SAXON)).toBe(true);
    expect(mayAttack(content, SAXON, VIKING)).toBe(true);
    expect(mayAttack(content, VIKING, VIKING)).toBe(false); // same-tribe friendly
  });

  it('runs the PvP drive through step(): each civ targets the other, resolving its OWN weapon', () => {
    const content = twoCivContent();
    const sim = new Simulation({ seed: 1, content, map: grass(5, 1) });
    const viking = fighterAt(sim, 0, 0, VIKING, 1_000_000);
    const saxon = fighterAt(sim, 1, 0, SAXON, 1_000_000); // 2 nodes away — within both weapons' reach

    sim.step(); // the full schedule: combatSystem picks targets, atomicSystem starts the swings

    // Each side engaged the OTHER (the mutual civ-vs-civ fight), through the real step() schedule.
    expect(sim.world.has(viking, CurrentAtomic)).toBe(true);
    expect(sim.world.has(saxon, CurrentAtomic)).toBe(true);

    const vEffect = sim.world.get(viking, CurrentAtomic).effect;
    const sEffect = sim.world.get(saxon, CurrentAtomic).effect;
    // ASYMMETRIC weapon binding: the viking swings the viking mace (50 dmg), the saxon the saxon sword
    // (30 dmg) — each resolves ITS OWN weapontypes row off settler.tribe, never a shared/hardcoded value.
    expect(vEffect).toMatchObject({ kind: 'attack', target: saxon, damage: 50 });
    expect(sEffect).toMatchObject({ kind: 'attack', target: viking, damage: 30 });

    // ASYMMETRIC swing duration: each side's attack atomic length resolves through ITS OWN
    // setatomic 81 -> animation -> length (viking_attack 4 vs saxon_attack 6).
    expect(sim.world.get(viking, CurrentAtomic).duration).toBe(4);
    expect(sim.world.get(saxon, CurrentAtomic).duration).toBe(6);
  });

  it("the saxon's longer reach lets it strike a viking the viking cannot yet hit back", () => {
    // The saxon sword reaches 3 nodes; the viking mace only 2. Placed 3 nodes apart, only the saxon has a
    // valid target this tick — the asymmetric reach band is a real, data-driven combat difference.
    const content = twoCivContent();
    const sim = new Simulation({ seed: 1, content, map: grass(6, 1) });
    const viking = fighterAt(sim, 0, 0, VIKING, 1_000_000);
    const saxon = fighterAtNode(sim, 3, 0, SAXON, 1_000_000); // 3 nodes — saxon reach 3, viking reach 2

    sim.step();

    expect(sim.world.has(saxon, CurrentAtomic)).toBe(true); // saxon reach 3 -> can strike
    expect(sim.world.get(saxon, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: viking });
    expect(sim.world.has(viking, CurrentAtomic)).toBe(false); // viking reach 2 -> no target in range
  });

  it('grinds a frail saxon down under viking blows and reaps it (target -> hit -> death)', () => {
    const content = twoCivContent();
    const sim = new Simulation({ seed: 1, content, map: grass(5, 1) });
    const viking = fighterAt(sim, 0, 0, VIKING, 1_000_000); // robust
    const saxon = fighterAt(sim, 1, 0, SAXON, 90); // frail: 90 HP < two viking 50-dmg blows

    let deaths = 0;
    for (let i = 0; i < 200 && sim.world.isAlive(saxon); i++) {
      sim.step();
      deaths += sim.snapshot().events.filter((ev) => ev.kind === 'settlerDied').length;
    }

    expect(sim.world.isAlive(saxon)).toBe(false); // the viking felled the frail saxon
    expect(sim.world.isAlive(viking)).toBe(true); // the viking (1e6 HP) survives the saxon's 30-dmg blows
    expect(deaths).toBe(1); // exactly one death announced (the felled saxon), for render/audio
  });

  it('is deterministic: two same-seed runs of the skirmish reach the same state hash', () => {
    const run = (): string => {
      const content = twoCivContent();
      const sim = new Simulation({ seed: 7, content, map: grass(5, 1) });
      fighterAt(sim, 0, 0, VIKING, 500);
      fighterAt(sim, 1, 0, SAXON, 500); // 2 nodes — inside both reach bands, so the skirmish really runs
      for (let i = 0; i < 60; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
