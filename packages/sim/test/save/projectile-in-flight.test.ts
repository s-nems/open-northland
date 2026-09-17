import { describe, expect, it } from 'vitest';
import { Health, Position, Projectile } from '../../src/components/index.js';
import {
  exportSaveGame,
  parseSaveGame,
  positionOfNode,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import { DEER, fighterAtNode, VIKING } from '../conflict/combat-system/support.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap } from '../fixtures/terrain.js';

/** The arrow's sound payload as `looseProjectile` copies it off the bow: the impact ids by the victim's
 *  material and the whole per-ground miss table. */
const BOW_HIT_SOUND = 77;
const BOW_MISS_SOUNDS = { '1': 78, '2': 79 } as const;

function restored(original: Simulation): Simulation {
  const save = parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(original))));
  const copy = restoreSimulation(save, { content: testContent(), map: grassCellMap(32, 32) });
  expect(copy.hashState()).toBe(original.hashState());
  return copy;
}

describe('save a projectile in flight', () => {
  it('keeps the arrow`s sound payload and lands the same miss event after loading', () => {
    const original = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(32, 32) });
    const shooter = fighterAtNode(original, 10, 10, VIKING, null);
    const deer = fighterAtNode(original, 20, 10, DEER, null);
    const aim = positionOfNode(15, 10); // bare ground short of the deer
    const shot = original.world.create();
    original.world.add(shot, Position, positionOfNode(10, 10));
    original.world.add(shot, Projectile, {
      source: shooter,
      target: deer,
      player: null,
      damage: { '0': 70 },
      hitSounds: { '0': BOW_HIT_SOUND },
      weaponMainType: null,
      missSounds: { ...BOW_MISS_SOUNDS },
      munitionType: 1,
      speed: 8,
      originX: positionOfNode(10, 10).x,
      originY: positionOfNode(10, 10).y,
      aimX: aim.x,
      aimY: aim.y,
      cover: null,
      launchTick: original.tick + 1,
      impact: null,
    });
    original.step(); // the rest at the bow: the arrow is now a persisted entity mid-flight

    const copy = restored(original);
    expect(copy.world.get(shot, Projectile)).toMatchObject({
      hitSounds: { '0': BOW_HIT_SOUND },
      missSounds: BOW_MISS_SOUNDS,
    });

    const misses = (sim: Simulation) => sim.snapshot().events.filter((ev) => ev.kind === 'projectileMissed');
    const originalMisses = [];
    const copyMisses = [];
    for (let i = 0; i < 10 && [...original.world.query(Projectile)].length > 0; i++) {
      original.step();
      copy.step();
      expect(copy.hashState(), `tick ${original.tick}`).toBe(original.hashState());
      originalMisses.push(...misses(original));
      copyMisses.push(...misses(copy));
    }
    expect(originalMisses).toHaveLength(1);
    expect(copyMisses).toEqual(originalMisses);
    expect(originalMisses[0]).toMatchObject({ missSounds: BOW_MISS_SOUNDS });
    expect(copy.world.get(deer, Health).hitpoints).toBe(1000); // a missed arrow, both sides
  });
});
