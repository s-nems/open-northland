import { describe, expect, it } from 'vitest';
import { Armor, Health, MoveSpeed, Owner, Settler, Weapon } from '../../../src/components/index.js';
import { fx } from '../../../src/index.js';
import { HUMAN_HITPOINTS } from '../../../src/systems/index.js';

import { fresh, nthEntity, VIKING, WOODCUTTER } from './support.js';

describe('CommandSystem - spawning', () => {
  it('spawnSettler creates a settler with the given job and emits settlerBorn', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 2, tribe: VIKING });
    sim.step();

    const e = nthEntity(sim, 0);
    const s = sim.world.get(e, Settler);
    expect(s.jobType).toBe(WOODCUTTER);
    expect(s.tribe).toBe(VIKING);
    expect(sim.events.current().some((ev) => ev.kind === 'settlerBorn')).toBe(true);
  });

  it('spawnSettler with no hitpoints gets the default Health pool (civilians have health too)', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 2, tribe: VIKING });
    sim.step();
    // The default (omitted hitpoints) path now stamps the shared default pool: EVERY settler carries
    // Health (the panel shows it, combat can strike it, starvation drains it).
    const health = sim.world.get(nthEntity(sim, 0), Health);
    expect(health.hitpoints).toBe(HUMAN_HITPOINTS);
    expect(health.max).toBe(HUMAN_HITPOINTS);
  });

  it('spawnSettler with hitpoints stamps a Health pool: the civ becomes a combatant from command data', () => {
    const sim = fresh();
    // A civilization soldier enters the world as a combatant THROUGH THE COMMAND SEAM (not a test reaching
    // into the world): a positive hitpoints pool stamps a full Health{hitpoints: max, max} in place of the
    // person's own pool.
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: WOODCUTTER,
      x: 1,
      y: 2,
      tribe: VIKING,
      hitpoints: 1000,
    });
    sim.step();
    const health = sim.world.get(nthEntity(sim, 0), Health);
    expect(health.hitpoints).toBe(1000);
    expect(health.max).toBe(1000); // a fresh combatant spawns at full health
  });

  it('spawnSettler with non-positive hitpoints falls back to the default pool (never a 0-HP spawn)', () => {
    const sim = fresh();
    // A 0 (or negative) pool would spawn an already-dead settler the cleanup reaper deletes the same
    // tick - treat it as "unspecified" and stamp the shared default instead.
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING, hitpoints: 0 });
    sim.step();
    expect(sim.world.get(nthEntity(sim, 0), Health).hitpoints).toBe(HUMAN_HITPOINTS);
  });

  it('spawnSettler with a positive armorClass stamps an Armor tier (the combatant wears armor)', () => {
    const sim = fresh();
    // A combatant entering the world wearing armor: a positive class stamps an `Armor` component, so a
    // hit on this settler is mitigated by the tier's blockingValue instead of landing on class 0.
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: WOODCUTTER,
      x: 1,
      y: 2,
      tribe: VIKING,
      hitpoints: 1000,
      armorClass: 3, // chain (blockingValue 5 in the fixture's armor table)
    });
    sim.step();
    expect(sim.world.get(nthEntity(sim, 0), Armor)).toEqual({ armorClass: 3 });
  });

  it('spawnSettler with no/non-positive armorClass leaves the settler unarmored (no Armor - class 0)', () => {
    const sim = fresh();
    // The default (omitted) and the non-positive (0) paths both stamp NO Armor - the separate-optional-
    // component pattern (like Health): a bare settler resolves as class 0, leaving the golden untouched.
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: WOODCUTTER,
      x: 0,
      y: 0,
      tribe: VIKING,
      hitpoints: 1000,
    });
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: WOODCUTTER,
      x: 1,
      y: 0,
      tribe: VIKING,
      hitpoints: 1000,
      armorClass: 0,
    });
    sim.step();
    expect(sim.world.has(nthEntity(sim, 0), Armor)).toBe(false); // omitted -> no armor
    expect(sim.world.has(nthEntity(sim, 1), Armor)).toBe(false); // class 0 -> no armor
  });

  it('spawnSettler with a positive weaponTypeId stamps a Weapon (the combatant wields a specific weapon)', () => {
    const sim = fresh();
    // A combatant entering the world holding a specific weapon: a positive id stamps a `Weapon` component,
    // so its attack resolves through that weapon (vs its tribe) instead of the class default.
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: WOODCUTTER,
      x: 1,
      y: 2,
      tribe: VIKING,
      hitpoints: 1000,
      weaponTypeId: 11, // test_spear (tribe 1) in the fixture
    });
    sim.step();
    expect(sim.world.get(nthEntity(sim, 0), Weapon)).toEqual({ weaponTypeId: 11 });
  });

  it('spawnSettler with no/non-positive weaponTypeId leaves the settler with its class default weapon (no Weapon)', () => {
    const sim = fresh();
    // The default (omitted) and the non-positive (0) paths both stamp NO Weapon - the separate-optional-
    // component pattern (like Armor): a bare settler falls back to its `(tribe, jobType)` weapon, golden untouched.
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: WOODCUTTER,
      x: 0,
      y: 0,
      tribe: VIKING,
      hitpoints: 1000,
    });
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: WOODCUTTER,
      x: 1,
      y: 0,
      tribe: VIKING,
      hitpoints: 1000,
      weaponTypeId: 0,
    });
    sim.step();
    expect(sim.world.has(nthEntity(sim, 0), Weapon)).toBe(false); // omitted -> no Weapon
    expect(sim.world.has(nthEntity(sim, 1), Weapon)).toBe(false); // id 0 -> no Weapon
  });

  it('spawnSettler with a positive moveSpeed stamps a MoveSpeed pace (ticks-per-tile, larger = slower)', () => {
    const sim = fresh();
    // A settler given an explicit walk pace carries a `MoveSpeed{perTick = ONE/moveSpeed}`, the creature
    // form, so moveSpeed 8 crosses a tile in 8 ticks. Used to pace a scene's settler without the human
    // step cost.
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 2, tribe: VIKING, moveSpeed: 8 });
    sim.step();
    expect(sim.world.get(nthEntity(sim, 0), MoveSpeed)).toEqual({
      perTick: fx.div(fx.fromInt(1), fx.fromInt(8)),
    });
  });

  it('spawnSettler with no/non-positive moveSpeed walks the universal default (no MoveSpeed - golden path)', () => {
    const sim = fresh();
    // The default (omitted) and the non-positive (0) paths both stamp NO MoveSpeed - the separate-optional-
    // component pattern (like Health/Armor/Weapon): a bare settler walks the human step cost, hash untouched.
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING });
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 0, tribe: VIKING, moveSpeed: 0 });
    sim.step();
    expect(sim.world.has(nthEntity(sim, 0), MoveSpeed)).toBe(false); // omitted -> no MoveSpeed
    expect(sim.world.has(nthEntity(sim, 1), MoveSpeed)).toBe(false); // 0 -> no MoveSpeed
  });

  it('spawnSettler with a valid owner stamps an Owner (the player that controls it)', () => {
    const sim = fresh();
    // A settler spawned for a player carries an Owner{player} - the gate the app uses to decide which
    // units the human may select and order. Orthogonal to tribe (the civilization).
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 2, tribe: VIKING, owner: 0 });
    sim.step();
    expect(sim.world.get(nthEntity(sim, 0), Owner)).toEqual({ player: 0 });
  });

  it('leaves an omitted-owner entity Owner-less (neutral - golden path)', () => {
    const sim = fresh();
    // Omitting the owner stamps NO Owner - the separate-optional-component pattern (like
    // Health/Armor/MoveSpeed): a neutral entity has none, leaving the golden hash untouched. Authored
    // setup keeps this path for intentionally unowned fixtures.
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING });
    sim.step();
    expect(sim.world.has(nthEntity(sim, 0), Owner)).toBe(false);
  });

  it('creates nothing for an explicit out-of-range owner', () => {
    const sim = fresh();
    // A slot outside `[0, MAX_PLAYERS)` names a player that cannot exist, so the spawn is refused
    // rather than quietly standing up an entity nobody owns.
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 0, tribe: VIKING, owner: 16 });
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 2, y: 0, tribe: VIKING, owner: -1 });
    sim.step();
    expect(sim.world.canonicalEntities()).toEqual([]);
    expect(sim.commands.log).toHaveLength(2); // both still logged for faithful replay
  });
});
