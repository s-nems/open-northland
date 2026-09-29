import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapScript, mapLobbySlots, TerrainMapFile } from '@open-northland/data';
import { components, type Entity, type Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { buildMapWorldFromInputs } from '../../src/entries/map/world-inputs.js';
import { sessionSeating } from '../../src/game/seat-tribes.js';
import { mapSession } from '../../src/game/session-url.js';
import { worldTribes } from '../../src/game/world-tribes.js';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

/** Six viking seats; the lobby plays the first as saracens and hands the second to the AI as egyptians. */
const MAP_ID = 'magiczny_las';
const VIKING = 1;
const SARACEN = 4;
const EGYPT = 7;
/** The map authors a werewolf pack, whose looks load whoever plays the seats. */
const WEREWOLF = 6;
const HUMAN_SEAT = 0;
const AI_SEAT = 1;
/** A seat the lobby left on the map's own civilization. */
const VIKING_SEAT = 2;
/** Long enough for the computer seat to lay out its first building sites. */
const OPENING_TICKS = 3000;

function readMap(): { map: TerrainMapFile; script: MapScript } {
  const root = resolve(contentDir(), 'maps');
  return {
    map: TerrainMapFile.parse(JSON.parse(readFileSync(resolve(root, `${MAP_ID}.json`), 'utf8'))),
    script: MapScript.parse(JSON.parse(readFileSync(resolve(root, `${MAP_ID}.script.json`), 'utf8'))),
  };
}

/** The tribes of a seat's buildings and of its settlers. */
function seatTribes(sim: Simulation, player: number) {
  const { Building, Owner, Settler } = components;
  const owned = (entities: Iterable<Entity>) =>
    [...entities].filter((e) => sim.world.has(e, Owner) && sim.world.get(e, Owner).player === player);
  return {
    buildings: new Set(owned(sim.world.query(Building)).map((e) => sim.world.get(e, Building).tribe)),
    settlers: new Set(owned(sim.world.query(Settler)).map((e) => sim.world.get(e, Settler).tribe)),
  };
}

describe.runIf(hasRealIr())(`${MAP_ID} with lobby-chosen civilizations`, () => {
  it('starts each changed seat as its chosen people and lets the computer build as one', async () => {
    const ir = rawIrUnderTest() as ContentIr;
    const { merge } = await loadContentUnderTest();
    const { map, script } = readMap();
    const params = new URLSearchParams(
      `map=${MAP_ID}&player=${HUMAN_SEAT}&ai=${AI_SEAT}&tribes=0:${SARACEN},1:${EGYPT}`,
    );
    const session = mapSession(params, mapLobbySlots(script));
    const { sim } = buildMapWorldFromInputs({
      map,
      ir,
      script,
      goodNames: new Map(),
      content: merge.content,
      session,
      missions: null,
      save: null,
    });
    expect(seatTribes(sim, HUMAN_SEAT).settlers).toEqual(new Set([SARACEN]));
    expect(seatTribes(sim, HUMAN_SEAT).buildings).toEqual(new Set([SARACEN]));
    expect(seatTribes(sim, AI_SEAT).settlers).toEqual(new Set([EGYPT]));
    expect(seatTribes(sim, VIKING_SEAT).settlers).toEqual(new Set([VIKING]));

    sim.run(OPENING_TICKS);
    expect(components.playerPlacementTribes(sim.world, HUMAN_SEAT)).toEqual([SARACEN]);
    expect(components.playerPlacementTribes(sim.world, AI_SEAT)).toEqual([EGYPT]);
    expect(seatTribes(sim, AI_SEAT).buildings).toEqual(new Set([EGYPT]));

    const seating = sessionSeating(session, script.players, ir);
    const art = worldTribes(
      { players: seating.players, missions: script.missions },
      map.entities,
      ir,
      seating.remap,
    );
    expect(art).toEqual([VIKING, SARACEN, WEREWOLF, EGYPT]);
  });
});
