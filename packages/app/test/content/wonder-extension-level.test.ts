import { components, TICKS_PER_SECOND } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr } from './helpers.js';
import { realMapScript, realMapWorld } from './real-map-world.js';

/**
 * The fifth Wonder stage raises the Artemis temple with `SetHouse` and grows it twice through
 * `SetHouseExtensionLevel` (its "LEVEL1and2" and "LEVEL3" missions). Their gates are long goals, so the
 * test opens them and keeps the script's own results and order.
 */
const MAP_ID = 'wonder-campaign_03_05';
/** The mission that activates the first growth step, the step itself, and the second growth step. */
const OPEN_FIRST = 49;
const FIRST_STEP = 50;
const SECOND_STEP = 51;
const WONDER_ID = 'wonder_artemis_temple';
/** The script's last `SetHouseExtensionLevel` amount. */
const SCRIPTED_LEVEL = 2;
const BUDGET_TICKS = 30 * TICKS_PER_SECOND;

describe.runIf(hasRealIr())(`${MAP_ID}: the scripted wonder growth`, () => {
  it('stands the Artemis temple at the scripted level', async () => {
    const script = realMapScript(MAP_ID);
    if (script === null) throw new Error(`${MAP_ID} ships no script`);
    const missions = script.missions.map((mission, index) => {
      if (index === OPEN_FIRST) return { ...mission, goals: [] };
      if (index === SECOND_STEP)
        return { ...mission, goals: [{ key: 'goal', values: ['IsMissionDone', String(FIRST_STEP)] }] };
      return mission;
    });
    const { sim, ir } = await realMapWorld({
      mapId: MAP_ID,
      machineSeats: [],
      script: { ...script, missions },
    });
    const wonderType = (ir.buildings ?? []).find((b) => b.id === WONDER_ID)?.typeId;
    expect(wonderType).toBeDefined();
    const wonders = () =>
      [...sim.world.query(components.Building)].filter(
        (e) => sim.world.get(e, components.Building).buildingType === wonderType,
      );
    const grown = () => sim.missionStatus().find((m) => m.index === SECOND_STEP)?.lastFiredTick !== undefined;
    for (let tick = 0; tick < BUDGET_TICKS && !grown(); tick++) sim.step();
    expect(grown()).toBe(true);
    expect(wonders().map((e) => sim.world.get(e, components.Building).level)).toEqual([SCRIPTED_LEVEL]);
  }, 300_000);
});
