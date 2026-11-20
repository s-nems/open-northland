import { components, FOG_MODE, halfCellMapFromCells, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../../../src/catalog/buildings.js';
import {
  applySessionRuleOverrides,
  depositYieldOf,
  sessionRuleOverrides,
} from '../../../src/game/match/session-rules.js';
import { sandboxContent } from '../../../src/game/sandbox/index.js';

const MAP = grassTerrain(8, 8);

/** A sim launched under `search`, stepped once so the enqueued rule commands have run. */
function launch(search: string): Simulation {
  const sim = new Simulation({ seed: 1, content: sandboxContent(MAP), map: halfCellMapFromCells(MAP) });
  applySessionRuleOverrides(sim, sessionRuleOverrides(new URLSearchParams(search)));
  sim.step();
  return sim;
}

describe('the on/off session rules', () => {
  it('keeps a world rule when its flag is absent or unrecognized', () => {
    const absent = sessionRuleOverrides(new URLSearchParams(''));
    expect([absent.needs, absent.progression]).toEqual([null, null]);
    const bogus = sessionRuleOverrides(new URLSearchParams('needs=bogus&progression=bogus'));
    expect([bogus.needs, bogus.progression]).toEqual([null, null]);
    expect(launch('').needsEnabled()).toBe(true); // the sim default a map inherits
  });

  it('carries ?needs= to the running sim in both directions', () => {
    expect(launch('needs=off').needsEnabled()).toBe(false);
    expect(launch('needs=on').needsEnabled()).toBe(true);
  });

  it('reads ?weathermode= as a presentation choice the sim never receives', () => {
    expect(sessionRuleOverrides(new URLSearchParams('weathermode=winter')).weather).toBe('winter');
    expect(sessionRuleOverrides(new URLSearchParams('weathermode=snow')).weather).toBeNull();
    expect(sessionRuleOverrides(new URLSearchParams('weather=snow')).weather).toBeNull();
    expect(launch('weathermode=winter').hashState()).toBe(launch('').hashState());
  });

  it('reads ?daynight= as a presentation choice the sim never receives', () => {
    expect(sessionRuleOverrides(new URLSearchParams('daynight=on')).dayNight).toBe('on');
    expect(sessionRuleOverrides(new URLSearchParams('daynight=dusk')).dayNight).toBeNull();
    expect(launch('daynight=on').hashState()).toBe(launch('').hashState());
  });

  it('carries ?alliedvision= to the running sim', () => {
    expect(sessionRuleOverrides(new URLSearchParams('')).alliedVision).toBeNull();
    expect(components.alliedVisionEnabled(launch('alliedvision=on').world)).toBe(true);
    expect(components.alliedVisionEnabled(launch('alliedvision=off').world)).toBe(false);
    expect(launch('').world.lowestEntityWith(components.AlliedVisionRules)).toBeNull();
  });

  it('reads ?peace= as one of the offered lengths, anything else as no peace', () => {
    expect(sessionRuleOverrides(new URLSearchParams('peace=45')).peace).toBe(45);
    expect(sessionRuleOverrides(new URLSearchParams('peace=50')).peace).toBeNull();
    expect(sessionRuleOverrides(new URLSearchParams('')).peace).toBeNull();
  });

  it('carries ?storage= to the running sim as one of the offered factors', () => {
    expect(components.storageCapacityFactor(launch('storage=3').world)).toBe(3);
    expect(sessionRuleOverrides(new URLSearchParams('storage=4')).storageCapacity).toBeNull();
    expect(launch('').world.lowestEntityWith(components.StorageRules)).toBeNull();
  });

  it('applies every flag on one launch without them interfering', () => {
    const sim = launch('fog=off&progression=off&needs=off');
    expect(sim.needsEnabled()).toBe(false);
    expect(sim.professionProgressionEnabled()).toBe(false);
    expect(sim.fogMode()).toBe(FOG_MODE.OFF);
  });
});

describe('the resource richness rules', () => {
  it('reads ?basicyield= and ?oreyield= as factors, an unoffered one as the authored stock', () => {
    const rules = sessionRuleOverrides(new URLSearchParams('basicyield=5&oreyield=2'));
    expect([rules.basicYield, rules.oreYield]).toEqual([5, 2]);
    const bogus = sessionRuleOverrides(new URLSearchParams('basicyield=1&oreyield=4'));
    expect([bogus.basicYield, bogus.oreYield]).toEqual([null, null]);
  });

  it('multiplies each group of goods by its own factor and leaves a null group out', () => {
    expect(depositYieldOf({ basicYield: 2, oreYield: null })).toEqual({
      wood: 2,
      mushroom: 2,
      mud: 2,
      stone: 2,
    });
    expect(depositYieldOf({ basicYield: null, oreYield: 3 })).toEqual({ iron: 3, gold: 3 });
  });
});
