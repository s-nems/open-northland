import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapScript } from '@open-northland/data';
import { components, Simulation, systems } from '@open-northland/sim';
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
 * The only name argument in the whole corpus the served catalog cannot resolve: one map writes the
 * handcart with its two words swapped, and the catalog spells it `handcart`. Everything else - the
 * upper-case `logicdefines.inc` macro tails, the capitalised tribe names - is the same slug under
 * another spelling. Any other unresolvable name is this join breaking, not a map being wrong.
 */
const CORPUS_UNKNOWN_NAMES = ['cart_hand'];

/** Passes to run a script for: enough that a mission with a short `TimeGone` fires. */
const SCRIPT_RUN_PASSES = 6;

/** A CnMod campaign map that opens with 104 of its 149 missions active: a real world, a real script,
 *  and most of its opcodes still without an evaluator. */
const CAMPAIGN_MAP = 'ucieczka_z_gazy';

function mapsDir(): string {
  return resolve(contentDir(), 'maps');
}

function sidecars(): string[] {
  return readdirSync(mapsDir())
    .filter((f) => f.endsWith('.script.json'))
    .sort();
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
              if (line[field] !== undefined && line[field] !== UNRESOLVED_NAME) {
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
    it('runs a real campaign map with its script on, exactly as `?missions=on` builds it', async () => {
      const { sim } = await realMapWorld({ mapId: CAMPAIGN_MAP, aiSeats: [], missions: true });
      // Events live for one tick, so the diagnostics are collected as the run goes.
      const unsupported = new Set<string>();
      for (let tick = 0; tick < systems.MISSION_EVALUATION_TICKS * SCRIPT_RUN_PASSES; tick++) {
        sim.step();
        for (const event of sim.events.current()) {
          if (event.kind === 'missionUnsupported') unsupported.add(event.opcode);
        }
      }
      const records = components.missionRecords(sim.world);
      expect(records.filter((r) => r.evaluated).length).toBeGreaterThan(0);
      // The world is real, so its placements carried their authored ids in with them.
      expect(systems.missionObjectIds(sim.world).length).toBeGreaterThan(0);
      // An opcode with no evaluator says so instead of throwing.
      expect(unsupported.size).toBeGreaterThan(0);
    });
  },
);
