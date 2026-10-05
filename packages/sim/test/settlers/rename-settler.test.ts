import { describe, expect, it } from 'vitest';
import { GivenName, ScriptedName, Settler } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { playerCommand, SETTLER_NAME_MAX_CHARS, Simulation } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

const VIKING = 1;
const OWNER = 0;
const RIVAL = 1;
const CARPENTER = 2;
/** The fixture's hero row (`hero_saber_hatschi`). */
const HERO = 45;

function settlerOf(jobType: number): { sim: Simulation; settler: Entity } {
  const sim = new Simulation({ seed: 1, content: testContent() });
  sim.enqueueSetup({ kind: 'spawnSettler', jobType, x: 2, y: 2, tribe: VIKING, owner: OWNER });
  sim.step();
  const settler = [...sim.world.query(Settler)].find((e) => sim.world.get(e, Settler).jobType === jobType);
  if (settler === undefined) throw new Error('setup: settler missing');
  return { sim, settler };
}

function rename(sim: Simulation, seat: number, entity: Entity, name: string): void {
  sim.enqueue(playerCommand(seat, { kind: 'renameSettler', entity, name }));
  sim.step();
}

describe('renameSettler - the player names a settler', () => {
  it('stores the trimmed name and clears it again with an empty one', () => {
    const { sim, settler } = settlerOf(CARPENTER);
    rename(sim, OWNER, settler, '  Ragnar  ');
    expect(sim.world.get(settler, GivenName).name).toBe('Ragnar');
    rename(sim, OWNER, settler, '   ');
    expect(sim.world.has(settler, GivenName)).toBe(false);
  });

  it('refuses an over-long name or one with a control character, keeping the old one', () => {
    const { sim, settler } = settlerOf(CARPENTER);
    rename(sim, OWNER, settler, 'Ragnar');
    rename(sim, OWNER, settler, 'x'.repeat(SETTLER_NAME_MAX_CHARS + 1));
    rename(sim, OWNER, settler, 'Rag\u0007nar');
    expect(sim.world.get(settler, GivenName).name).toBe('Ragnar');
    rename(sim, OWNER, settler, 'ż'.repeat(SETTLER_NAME_MAX_CHARS));
    expect(sim.world.get(settler, GivenName).name).toBe('ż'.repeat(SETTLER_NAME_MAX_CHARS));
  });

  it('refuses a scripted name even without the map text being loaded', () => {
    const { sim, settler } = settlerOf(CARPENTER);
    sim.world.add(settler, ScriptedName, { stringId: 7 });
    rename(sim, OWNER, settler, 'Ada');
    expect(sim.world.has(settler, GivenName)).toBe(false);
  });

  it('refuses a hero and a settler of another seat', () => {
    const hero = settlerOf(HERO);
    rename(hero.sim, OWNER, hero.settler, 'Ragnar');
    expect(hero.sim.world.has(hero.settler, GivenName)).toBe(false);

    const { sim, settler } = settlerOf(CARPENTER);
    rename(sim, RIVAL, settler, 'Ragnar');
    expect(sim.world.has(settler, GivenName)).toBe(false);
  });
});
