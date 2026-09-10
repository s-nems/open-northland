import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapScript } from '@open-northland/data';
import type { Entity } from '@open-northland/sim';
import { components, Simulation, systems, TICKS_PER_SECOND } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  type AuthoredJoinRows,
  MISSION_NAME_FIELDS,
  resolveMissionScript,
  UNRESOLVED_NAME,
} from '../../src/game/world/index.js';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';
import { realMapWorld } from './real-map-world.js';

/**
 * The whole corpus through the map-script join and then through the engine: every mission of every
 * generated sidecar resolves against the served catalog, and the largest script runs its passes
 * without the sim throwing on an opcode it cannot evaluate.
 */

/**
 * The only name arguments in the whole corpus the served catalog cannot resolve, all of them maps
 * naming something that does not exist: one writes the handcart with its two words swapped, and one
 * `SetHouse`s two byzantine workshops the house table never declares (the tribe has a tower and a
 * kaserne, no joinery or pottery). Everything else - the upper-case `logicdefines.inc` macro tails,
 * the capitalised tribe names - is the same slug under another spelling. Any other unresolvable name
 * is this join breaking, not a map being wrong.
 */
const CORPUS_UNKNOWN_NAMES = ['byzantine joinery', 'byzantine pottery', 'cart_hand'];

/** Passes to run a script for: enough that a mission with a short `TimeGone` fires. */
const SCRIPT_RUN_PASSES = 6;

/** Building and stepping a real campaign world costs about a second on its own, and the suite runs
 *  these files in parallel; the default 5s budget is not enough under that load. */
const REAL_MAP_TIMEOUT_MS = 30_000;

/** A CnMod campaign map that opens with 104 of its 149 missions active: a real world and a real
 *  script, which opens on a briefing. */
const CAMPAIGN_MAP = 'ucieczka_z_gazy';

/** The CnMod campaign map whose second mission is the corpus's first wave: `TimeGone 30`, then
 *  eleven swordsmen with no id and two heroes carrying ids 133 and 134. */
const WAVE_MAP = 'cn_1';
const WAVE_SECONDS = 30;
const WAVE_PLAYER = 2;
const WAVE_SIZE = 13;
const WAVE_HERO_IDS = [133, 134];
/** The mask every line of the wave carries: needs frozen (bit 0) and not player-controllable (5). */
const WAVE_BEHAVIOUR = 33;

function mapsDir(): string {
  return resolve(contentDir(), 'maps');
}

function sidecars(): string[] {
  return readdirSync(mapsDir())
    .filter((f) => f.endsWith('.script.json'))
    .sort();
}

/** Whether a name field holds a resolved id. The house-instance kind resolves to a type and its
 *  tribe at once, so it answers with a pair rather than a bare id. */
function resolvedName(value: unknown): boolean {
  if (value === undefined || value === UNRESOLVED_NAME) return false;
  if (typeof value === 'object' && value !== null && 'typeId' in value) {
    return value.typeId !== UNRESOLVED_NAME;
  }
  return true;
}

function humansEntitiesOf(sim: Simulation, player: number): Entity[] {
  return [...sim.world.query(components.Person)].filter((e) => components.ownerOf(sim.world, e) === player);
}

function humansOf(sim: Simulation, player: number): number {
  return humansEntitiesOf(sim, player).length;
}

function scriptOf(file: string): MapScript {
  return MapScript.parse(JSON.parse(readFileSync(resolve(mapsDir(), file), 'utf8')));
}

describe.runIf(hasRealIr() && existsSync(resolve(contentDir(), 'maps')))(
  'the map-script join over the real corpus',
  () => {
    it('resolves every name argument the served catalog knows, in every field', () => {
      const rows = rawIrUnderTest() as AuthoredJoinRows;
      const resolvedPerField = new Map(MISSION_NAME_FIELDS.map((field) => [field, 0]));
      const unknown = new Set<string>();
      let missions = 0;
      for (const file of sidecars()) {
        const script = scriptOf(file);
        const join = resolveMissionScript(script.missions, rows);
        missions += script.missions.length;
        for (const name of join.unresolvedNames) unknown.add(name);
        for (const mission of join.script.missions) {
          for (const line of [...mission.goals, ...mission.results] as Record<string, unknown>[]) {
            for (const field of MISSION_NAME_FIELDS) {
              if (resolvedName(line[field])) {
                resolvedPerField.set(field, (resolvedPerField.get(field) ?? 0) + 1);
              }
            }
          }
        }
      }
      expect(missions).toBeGreaterThan(1000);
      expect([...unknown].sort()).toEqual(CORPUS_UNKNOWN_NAMES);
      // Per field, so a join that resolves nothing at all cannot hide behind the four that work:
      // `vehicleType` is only 160 of the corpus's ~10,700 name arguments.
      for (const [field, resolved] of resolvedPerField) {
        expect(`${field}: ${resolved > 0}`).toBe(`${field}: true`);
      }
    });

    it('runs the largest script through the engine without throwing', async () => {
      const rows = rawIrUnderTest() as AuthoredJoinRows;
      const largest = sidecars()
        .map((file) => scriptOf(file))
        .reduce((a, b) => (b.missions.length > a.missions.length ? b : a));
      const { script } = resolveMissionScript(largest.missions, rows);
      const sim = new Simulation({
        seed: 1,
        content: (await loadContentUnderTest()).merge.content,
        missions: script,
      });
      sim.enqueueSetup({ kind: 'setMissionsEnabled', enabled: true });
      sim.run(systems.MISSION_EVALUATION_TICKS * SCRIPT_RUN_PASSES);
      const records = components.missionRecords(sim.world);
      expect(records).toHaveLength(largest.missions.length);
      // A real campaign script opens with active missions and fires some of them straight away.
      expect(records.filter((r) => r.evaluated).length).toBeGreaterThan(0);
    });
    it(
      'runs a real campaign map with its script on, exactly as `?missions=on` builds it',
      async () => {
        const { sim } = await realMapWorld({ mapId: CAMPAIGN_MAP, aiSeats: [], missions: true });
        // Events live for one tick, so the briefing is caught as the run goes.
        const briefings: number[] = [];
        for (let tick = 0; tick < systems.MISSION_EVALUATION_TICKS * SCRIPT_RUN_PASSES; tick++) {
          sim.step();
          for (const event of sim.events.current()) {
            if (event.kind === 'missionCutscene') briefings.push(event.page);
          }
        }
        const records = components.missionRecords(sim.world);
        expect(records.filter((r) => r.evaluated).length).toBeGreaterThan(0);
        // The world is real, so its placements carried their authored ids in with them.
        expect(systems.missionObjectIds(sim.world).length).toBeGreaterThan(0);
        // The campaign opens on its briefing, which the window would open on and replay.
        expect(briefings.length).toBeGreaterThan(0);
        expect(sim.missionBriefingPage()).toBe(briefings[0]);
      },
      REAL_MAP_TIMEOUT_MS,
    );

    it(
      'spawns a real campaign map`s opening wave when its timer runs out',
      async () => {
        const { sim } = await realMapWorld({ mapId: WAVE_MAP, aiSeats: [], missions: true });
        const before = humansOf(sim, WAVE_PLAYER);
        // One pass past the goal's span, since a mission is only checked on the cadence.
        sim.run(WAVE_SECONDS * TICKS_PER_SECOND + systems.MISSION_EVALUATION_TICKS);
        expect(humansOf(sim, WAVE_PLAYER) - before).toBe(WAVE_SIZE);
        // The two the script named are addressable by the ids their lines carry.
        for (const id of WAVE_HERO_IDS) {
          expect(`${id}: ${systems.missionObjects(sim.world, id).length}`).toBe(`${id}: 1`);
        }
        // And every one of them arrives under the mask its line wrote, which this map uses to put the
        // wave beyond the player's orders and off the needs ladder.
        const masked = humansEntitiesOf(sim, WAVE_PLAYER).filter(
          (e) => sim.world.tryGet(e, components.MissionBehaviour)?.flags === WAVE_BEHAVIOUR,
        );
        expect(masked.length).toBe(WAVE_SIZE);
      },
      REAL_MAP_TIMEOUT_MS,
    );
  },
);
