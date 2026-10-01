import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapScript, mapLobbySlots, TerrainMapFile } from '@open-northland/data';
import { components, exportSaveGame, type SaveGame, type Simulation } from '@open-northland/sim';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { loadMapScript, loadTerrainMap } from '../../src/content/map-loader.js';
import { loadMapList } from '../../src/content/maps-index.js';
import { mapSubMissionLoader } from '../../src/entries/map/sub-missions.js';
import { buildMapWorldFromInputs } from '../../src/entries/map/world-inputs.js';
import { sessionSeating } from '../../src/game/seat-tribes.js';
import { mapSession } from '../../src/game/session-url.js';
import { worldTribes } from '../../src/game/world-tribes.js';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

vi.mock('../../src/content/map-loader.js', () => ({ loadTerrainMap: vi.fn(), loadMapScript: vi.fn() }));
vi.mock('../../src/content/maps-index.js', () => ({ loadMapList: vi.fn() }));

/** The main map's script opens this sub-mission (`StartSubMission 0 59504`) and it ends back home. */
const PARENT = 'wilczy_lad';
const CHILD = 'wilczy_lad_sub';
const CHILD_CAMPAIGN = { campaignId: 0, missionId: 59504 };
const HUMAN_SEAT = 0;
const VIKING = 1;
const FRANK = 2;
const BYZANTINE = 3;
/** The heroes by their `sethuman` mission ids; Siegfried joins in the sub-mission only. */
const BJARNI = 100;
const XENA = 101;
const SIEGFRIED = 102;
const OPENING_TICKS = 5;

function readMap(mapId: string): { map: TerrainMapFile; script: MapScript } {
  const root = resolve(contentDir(), 'maps');
  return {
    map: TerrainMapFile.parse(JSON.parse(readFileSync(resolve(root, `${mapId}.json`), 'utf8'))),
    script: MapScript.parse(JSON.parse(readFileSync(resolve(root, `${mapId}.script.json`), 'utf8'))),
  };
}

function heroTribes(sim: Simulation): ReadonlyMap<number, number> {
  const { MissionObjectId, Settler } = components;
  const tribes = new Map<number, number>();
  for (const e of sim.world.query(Settler, MissionObjectId)) {
    tribes.set(sim.world.get(e, MissionObjectId).id, sim.world.get(e, Settler).tribe);
  }
  return tribes;
}

function seatSettlerTribes(sim: Simulation, player: number): ReadonlySet<number> {
  const { Owner, Settler } = components;
  return new Set(
    [...sim.world.query(Settler, Owner)]
      .filter((e) => sim.world.get(e, Owner).player === player)
      .map((e) => sim.world.get(e, Settler).tribe),
  );
}

describe.runIf(hasRealIr())(`${PARENT} played as franks through its sub-mission`, () => {
  beforeEach(() => {
    vi.mocked(loadMapList).mockResolvedValue([
      { id: CHILD, picture: true, minimap: true, campaign: CHILD_CAMPAIGN },
    ]);
    vi.mocked(loadTerrainMap).mockImplementation(async (id) => readMap(id).map);
    vi.mocked(loadMapScript).mockImplementation(async (id) => readMap(id).script);
  });

  it('carries the chosen civilization into the sub-mission and back, heroes keeping their own', async () => {
    const ir = rawIrUnderTest() as ContentIr;
    const { merge } = await loadContentUnderTest();
    const entry = `map=${PARENT}&player=${HUMAN_SEAT}&tribes=${HUMAN_SEAT}:${FRANK}`;
    const params = new URLSearchParams(entry);
    const build = (mapId: string, search: URLSearchParams, save: SaveGame | null) => {
      const { map, script } = readMap(mapId);
      return buildMapWorldFromInputs({
        map,
        ir,
        script,
        goodNames: new Map(),
        content: merge.content,
        session: mapSession(search, mapLobbySlots(script)),
        missions: null,
        save,
      }).sim;
    };
    const sim = build(PARENT, params, null);
    sim.run(OPENING_TICKS);
    const parentSave = exportSaveGame(sim, { mapId: PARENT, entry: `?${entry}` });

    const load = mapSubMissionLoader({ ir, content: { content: sim.content }, params });
    const child = await load(
      { kind: 'start', ...CHILD_CAMPAIGN, mapId: CHILD_CAMPAIGN.missionId, mission: 0 },
      parentSave,
    );
    const childEntry = child.header.entry ?? '';
    const childSearch = new URLSearchParams(childEntry.slice(1));
    expect(childSearch.get('map')).toBe(CHILD);
    expect(childSearch.get('tribes')).toBe(`${HUMAN_SEAT}:${FRANK}`);
    // The relaunch restores the child from its save and loads the art its entry's seats field.
    const childSim = build(CHILD, childSearch, child);
    expect(heroTribes(childSim)).toEqual(
      new Map([
        [XENA, BYZANTINE],
        [BJARNI, VIKING],
        [SIEGFRIED, FRANK],
      ]),
    );
    const { map: childMap, script: childScript } = readMap(CHILD);
    const seating = sessionSeating(
      mapSession(childSearch, mapLobbySlots(childScript)),
      childScript.players,
      ir,
    );
    expect(seating.players.find((row) => row.player === HUMAN_SEAT)?.tribeId).toBe(FRANK);
    expect(worldTribes(seating, childMap.entities, ir, seating.remap)).toEqual(
      expect.arrayContaining([VIKING, FRANK, BYZANTINE]),
    );

    const returned = await load(
      { kind: 'end', mission: 1 },
      exportSaveGame(childSim, { mapId: CHILD, entry: childEntry, parent: parentSave }),
    );
    expect(returned.header.entry).toBe(`?${entry}`);
    const home = build(PARENT, params, returned);
    expect(seatSettlerTribes(home, HUMAN_SEAT)).toEqual(new Set([FRANK, VIKING, BYZANTINE]));
    expect(heroTribes(home).get(BJARNI)).toBe(VIKING);
    expect(home.hashState()).toBe(sim.hashState());
  });
});
