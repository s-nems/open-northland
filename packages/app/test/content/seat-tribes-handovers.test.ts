import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  decodeMissionResult,
  isCivilizationTribe,
  MapScript,
  type MapScriptLine,
  mapLobbySlots,
  TerrainMapFile,
} from '@open-northland/data';
import { components, type Entity, type SimEvent, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { buildMapWorldFromInputs } from '../../src/entries/map/world-inputs.js';
import { mapSession } from '../../src/game/session-url.js';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

/**
 * Every map whose script hands things between seats, played with the person's seat on another
 * civilization: once its spawn, id-stamping and handover lines have all run, the world build has
 * already moved everything that reached the seat, so the handover safety net never fires and no
 * settler of the seat's authored people (heroes aside) is left in it. Point `ON_CONTENT_DIR` at a
 * content set with the campaigns to cover them.
 */

const VIKING = 1;
const BYZANTINE = 3;
const SEED = 7;
/** The script loads on the first tick and runs its forced mission in that pass; one more settles it. */
const FORCED_TICKS = 2;
/** A large campaign map takes several seconds to build on a contended machine. */
const MAP_TIMEOUT_MS = 120_000;

const SPAWNS = new Set(['SetHuman', 'SetHumanX', 'SetVehicle', 'SetHouse']);
const STAMPS = new Set([
  'ChangeHumanObjectIdInArea',
  'ChangeMissionIdOfHumanInRange',
  'ChangeMissionIdOfPlayer',
  'ChangeMissionIdOfVehicles',
  'ChangeMissionIdOfVehiclesInRange',
  'ChangeMissionIdOfPlayersVehiclesOnContinent',
]);
const HANDOVERS = new Set([
  'ChangePlayerPlayerId',
  'ChangePlayerIdInArea',
  'ChangeHumanPlayerId',
  'ChangeHousesPlayerId',
  'ChangeVehiclesPlayerId',
]);

function mapsDir(): string {
  return resolve(contentDir(), 'maps');
}

function readScript(mapId: string): MapScript {
  return MapScript.parse(JSON.parse(readFileSync(resolve(mapsDir(), `${mapId}.script.json`), 'utf8')));
}

function linesOf(script: MapScript, opcodes: ReadonlySet<string>): MapScriptLine[] {
  return script.missions.flatMap((mission) =>
    mission.results.filter((line) => opcodes.has(decodeMissionResult(line).opcode)),
  );
}

function handoverMaps(): string[] {
  if (!existsSync(mapsDir())) return [];
  return readdirSync(mapsDir())
    .filter((file) => file.endsWith('.script.json'))
    .map((file) => file.slice(0, -'.script.json'.length))
    .filter((mapId) => existsSync(resolve(mapsDir(), `${mapId}.json`)))
    .filter((mapId) => linesOf(readScript(mapId), HANDOVERS).length > 0)
    .sort();
}

/** The script with its own missions idle and one mission that runs every spawn, then every id stamp,
 *  then every handover, in authored order. */
function forcedScript(script: MapScript): MapScript {
  const forced = {
    debugName: 'forced handovers',
    other: [],
    active: true,
    goals: [{ key: 'goal', values: ['True'] }],
    results: [...linesOf(script, SPAWNS), ...linesOf(script, STAMPS), ...linesOf(script, HANDOVERS)],
  };
  return {
    ...script,
    missions: [...script.missions.map((mission) => ({ ...mission, active: false })), forced],
  };
}

/** One run: the person's seat, and the seats the session plays as another civilization (the person's
 *  first; any other is a computer seat). */
interface SeatCase {
  readonly mapId: string;
  readonly label: string;
  readonly person: number;
  readonly retribed: readonly number[];
}

/** Every map from its first claimable civilization seat; a map with two also from its second, and with
 *  both re-tribed at once, where a thing that reaches both takes the first seat's choice. */
function seatCases(): SeatCase[] {
  return handoverMaps().flatMap((mapId) => {
    const seats = mapLobbySlots(readScript(mapId))
      .filter((slot) => slot.claimable && isCivilizationTribe(slot.tribeId))
      .map((slot) => slot.player);
    const [first, second] = seats;
    if (first === undefined) return [];
    const cases: SeatCase[] = [{ mapId, label: 'its first seat', person: first, retribed: [first] }];
    if (second !== undefined) {
      cases.push({ mapId, label: 'its second seat', person: second, retribed: [second] });
      cases.push({ mapId, label: 'two re-tribed seats', person: first, retribed: [first, second] });
    }
    return cases;
  });
}

const otherPeople = (tribe: number): number => (tribe === BYZANTINE ? VIKING : BYZANTINE);

describe.runIf(hasRealIr())('a seat played as another civilization through its handovers', () => {
  it.each(seatCases())(
    '$mapId from $label moves everything handed to a re-tribed seat at world build',
    async ({ mapId, person, retribed }) => {
      const ir = rawIrUnderTest() as ContentIr;
      const { merge } = await loadContentUnderTest();
      const script = readScript(mapId);
      const slots = mapLobbySlots(script);
      const authored = new Map(slots.map((slot) => [slot.player, slot.tribeId]));
      const tribes = retribed.map((seat) => `${seat}:${otherPeople(authored.get(seat) ?? VIKING)}`);
      const computers = retribed.filter((seat) => seat !== person);
      const map = TerrainMapFile.parse(JSON.parse(readFileSync(resolve(mapsDir(), `${mapId}.json`), 'utf8')));
      const params = new URLSearchParams(
        `map=${mapId}&player=${person}&tribes=${tribes.join(',')}&seed=${SEED}` +
          (computers.length > 0 ? `&computer=${computers.join(',')}` : ''),
      );
      const { sim } = buildMapWorldFromInputs({
        map,
        ir,
        script: forcedScript(script),
        content: merge.content,
        session: mapSession(params, slots),
        missions: true,
        save: null,
      });
      const corrected: SimEvent[] = [];
      for (let tick = 0; tick < FORCED_TICKS; tick++) {
        sim.run(1);
        corrected.push(...sim.events.current().filter((event) => event.kind === 'missionSeatTribeCorrected'));
      }
      expect(corrected).toEqual([]);

      // Houses are left out: a type the chosen people do not draw keeps its tribe by design.
      const { Owner, Person, Settler, Vehicle } = components;
      for (const seat of retribed) {
        const owned = (e: Entity) => sim.world.get(e, Owner).player === seat;
        const people = authored.get(seat);
        const settlersLeft = [...sim.world.query(Person, Settler, Owner)].filter(
          (e) =>
            owned(e) &&
            sim.world.get(e, Settler).tribe === people &&
            !systems.isHeroJob(merge.content, sim.world.get(e, Settler).jobType),
        );
        const vehiclesLeft = [...sim.world.query(Vehicle, Owner)].filter(
          (e) => owned(e) && sim.world.get(e, Vehicle).tribe === people,
        );
        expect({ seat, settlersLeft, vehiclesLeft }).toEqual({ seat, settlersLeft: [], vehiclesLeft: [] });
      }
    },
    MAP_TIMEOUT_MS,
  );
});
