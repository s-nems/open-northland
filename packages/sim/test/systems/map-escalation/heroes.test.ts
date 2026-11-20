import { MapModules, type MapModulesInput } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Equipment,
  Health,
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
  Owner,
  ScriptedName,
  Settler,
  VisualScale,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  type Simulation,
  serializeSaveGame,
} from '../../../src/index.js';
import {
  AMULET_SECONDS,
  DEFENSE_AMULET,
  distance,
  FORTRESS,
  GEARED,
  gearContent,
  KEEP,
  keepWorld,
  MAP,
  runToSecond,
  SCRIPT,
  SPEARMAN,
  SPEARMAN_SLUG,
  VIKING_SLUG,
  WOOL,
} from '../../fixtures/map-escalation/keep.js';
import { needsOf } from '../../fixtures/settler.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

const HERO_HITPOINTS = 30000;
const NAME_STRING_ID = 90001;
/** Beside the keep, which stands on the keep point. */
const HERO_AT = { x: KEEP.x, y: KEEP.y + 8 };
/** How far a defender standing his ground may have moved. */
const HOLD_NODES = 4;
const TALLER_PCT = 120;

function heroModule(hero = false, scalePct?: number): NonNullable<MapModulesInput['heroes']> {
  return {
    version: 1,
    placed: [
      {
        seat: FORTRESS,
        job: SPEARMAN_SLUG,
        tribe: VIKING_SLUG,
        ...HERO_AT,
        hitpoints: HERO_HITPOINTS,
        equipment: ['armor_wool', 'amulet_defense'],
        nameStringId: NAME_STRING_ID,
        hero,
        ...(scalePct !== undefined ? { scalePct } : {}),
      },
    ],
  };
}

function heroConfig(hero = false, scalePct?: number): MapModulesInput {
  return { ...GEARED, heroes: heroModule(hero, scalePct) };
}

function heroWorld(hero = false, scalePct?: number): Simulation {
  return keepWorld(heroConfig(hero, scalePct), gearContent(), { scriptedFortress: true }).sim;
}

function heroesOf(sim: Simulation): Entity[] {
  return [...sim.world.query(ScriptedName, Owner)].filter((e) => sim.world.get(e, Owner).player === FORTRESS);
}

describe('map escalation - heroes', () => {
  it('places each defender once with his hitpoints, gear and name, holding his ground past the gear steps', () => {
    const sim = heroWorld();
    const [hero, ...more] = heroesOf(sim);
    if (hero === undefined) throw new Error('no hero');
    expect(more).toEqual([]);
    expect(sim.world.get(hero, Settler).jobType).toBe(SPEARMAN);
    expect(sim.world.get(hero, Health)).toEqual({ hitpoints: HERO_HITPOINTS, max: HERO_HITPOINTS });
    expect(sim.world.get(hero, ScriptedName).stringId).toBe(NAME_STRING_ID);
    expect(hasMissionBehaviour(sim.world, hero, MISSION_BEHAVIOUR.NOT_CONTROLLABLE)).toBe(true);
    const placed = () => {
      const eq = sim.world.get(hero, Equipment);
      return {
        armor: eq.armor?.goodType,
        misc: eq.misc.flatMap((slot) => (slot === null ? [] : [slot.goodType])),
      };
    };
    expect(placed()).toEqual({ armor: WOOL, misc: [DEFENSE_AMULET] });

    runToSecond(sim, AMULET_SECONDS + 1);
    expect(heroesOf(sim)).toEqual([hero]);
    expect(placed()).toEqual({ armor: WOOL, misc: [DEFENSE_AMULET] });
    expect(distance(sim, hero, HERO_AT)).toBeLessThanOrEqual(HOLD_NODES);
  });

  it('marks a hero with the glow and needs that never fall, and a plain defender with neither', () => {
    const run = (hero: boolean) => {
      const sim = heroWorld(hero);
      const [placed] = heroesOf(sim);
      if (placed === undefined) throw new Error('no hero');
      const before = needsOf(sim, placed);
      runToSecond(sim, AMULET_SECONDS + 1);
      return {
        glows: hasMissionBehaviour(sim.world, placed, MISSION_BEHAVIOUR.GLOWS),
        hungerRose: needsOf(sim, placed).hunger > before.hunger,
        fatigueRose: needsOf(sim, placed).fatigue > before.fatigue,
      };
    };
    expect(run(true)).toEqual({ glows: true, hungerRose: false, fatigueRose: false });
    expect(run(false)).toEqual({ glows: false, hungerRose: true, fatigueRose: true });
  });

  it('draws a hero at his scale through a save, and a plain defender with no scale at all', () => {
    const sim = heroWorld(true, TALLER_PCT);
    const [hero] = heroesOf(sim);
    if (hero === undefined) throw new Error('no hero');
    expect(sim.world.tryGet(hero, VisualScale)).toEqual({ pct: TALLER_PCT });

    const save = parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim))));
    const restored = restoreSimulation(save, {
      content: sim.content,
      map: grassNodeMap(MAP, MAP),
      mapAiScript: SCRIPT,
      mapModules: MapModules.parse(heroConfig(true, TALLER_PCT)),
    });
    expect(restored.world.tryGet(hero, VisualScale)).toEqual({ pct: TALLER_PCT });

    const plainSim = heroWorld(true);
    const [plain] = heroesOf(plainSim);
    if (plain === undefined) throw new Error('no hero');
    expect(plainSim.world.has(plain, VisualScale)).toBe(false);
  });

  it('places its defenders on a map that runs no siege', () => {
    const sim = keepWorld({ heroes: heroModule() }, gearContent(), { scriptedFortress: true }).sim;
    const [hero, ...more] = heroesOf(sim);
    if (hero === undefined) throw new Error('no hero');
    expect(more).toEqual([]);
    expect(sim.world.get(hero, Health).hitpoints).toBe(HERO_HITPOINTS);
    expect(sim.mapEscalationView()).toBeNull();
  });
});
