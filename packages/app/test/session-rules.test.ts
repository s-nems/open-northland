import { FOG_MODE, halfCellMapFromCells, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../src/catalog/buildings.js';
import { sandboxContent } from '../src/game/sandbox/index.js';
import { applySessionRuleOverrides, sessionRuleOverrides } from '../src/game/session-rules.js';

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

  it('applies every flag on one launch without them interfering', () => {
    const sim = launch('fog=off&progression=off&needs=off');
    expect(sim.needsEnabled()).toBe(false);
    expect(sim.professionProgressionEnabled()).toBe(false);
    expect(sim.fogMode()).toBe(FOG_MODE.OFF);
  });
});
