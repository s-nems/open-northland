import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CifLine } from '@open-northland/formats/cif';
import { describe, expect, it } from 'vitest';
import { resolveMissionScript } from '../../../../../packages/app/src/game/world/mission-script.js';
import { buildStringCif } from '../../../../../packages/formats/test/fixtures/cif.js';
import { buildMapDat } from '../../../../../packages/formats/test/fixtures/mapdat.js';
import {
  addPerson,
  Building,
  MissionObjectId,
  Owner,
  Position,
  Residence,
  Resting,
} from '../../../../../packages/sim/src/components/index.js';
import type { Entity } from '../../../../../packages/sim/src/ecs/world.js';
import { fx, ONE, positionOfNode, Simulation } from '../../../../../packages/sim/src/index.js';
import { spawnNewborn } from '../../../../../packages/sim/src/systems/spawn/newborn.js';
import { testContent } from '../../../../../packages/sim/test/fixtures/content.js';
import { loadSourceCorrections } from '../../../src/corrections.js';
import { convertMapDatTree } from '../../../src/stages/maps/index.js';
import { makeTempDir } from '../../support/game-tree.js';

/** Synthetic scaffold at the correction's pinned line numbers; no source map is copied into tests. */
async function correctedScript() {
  const temp = await makeTempDir('tutorial-child-goal');
  try {
    const file = 'maps/community/sample/map.cif';
    const lines: CifLine[] = Array.from({ length: 69 }, () => ({ level: 2, text: 'description -1' }));
    const put = (line: number, text: string, level = 2) => {
      lines[line - 1] = { level, text };
    };
    put(1, 'MissionData', 1);
    put(2, 'active 1');
    put(3, 'goal "True"');
    put(4, 'result "ChangeHumanPlayerId" 3 1');
    put(5, 'result "ActivateMission" 1');
    put(64, 'MissionData', 1);
    put(67, 'goal "HumansWithHome" 0 6');
    put(68, 'goal "NumberOfCivilainsNearPos" 0 127 189 20 3');
    put(69, 'result "PlayCutscene" 5 1');
    const bytes = buildStringCif(lines);
    const data = join(temp.path, 'data');
    const dir = join(temp.path, 'corrections');
    await mkdir(join(data, 'maps/community/sample'), { recursive: true });
    await mkdir(dir);
    await writeFile(join(data, file), bytes);
    await writeFile(join(data, 'maps/community/sample/map.dat'), buildMapDat(1, 1, [2, 2, 2, 2]));
    const named = JSON.parse(
      await readFile(new URL('../../../corrections/tutorial-002-child-goal.json', import.meta.url), 'utf8'),
    );
    await writeFile(
      join(dir, 'lesson.json'),
      JSON.stringify({ ...named, file, sha256: createHash('sha256').update(bytes).digest('hex') }),
    );
    const [original] = await convertMapDatTree({ data }, join(temp.path, 'original'));
    const corrections = await loadSourceCorrections(dir, data);
    const [map] = await convertMapDatTree({ data, corrections }, join(temp.path, 'out'));
    corrections.assertApplied();
    const resolved = resolveMissionScript(map?.script?.missions ?? [], {
      jobs: [
        { typeId: 1, id: 'baby_female' },
        { typeId: 2, id: 'baby_male' },
      ],
    });
    expect(resolved.unresolvedNames).toEqual([]);
    expect(resolved.tokenMismatches).toBe(0);
    return {
      corrected: resolved.script,
      original: resolveMissionScript(original?.script?.missions ?? [], {}).script,
    };
  } finally {
    await temp.cleanup();
  }
}

function person(sim: Simulation, jobType: number, player: number, alias: number, home: Entity): Entity {
  const e = sim.world.create();
  addPerson(sim.world, e, {
    tribe: 1,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Owner, { player });
  sim.world.add(e, Position, positionOfNode(127, 189));
  sim.world.add(e, MissionObjectId, { id: alias });
  sim.world.add(e, Residence, { home, since: 0 });
  return e;
}

describe('tutorial child goal correction', () => {
  it.each(['female', 'male'] as const)(
    'waits for an actual %s newborn, independent of the shoreline and without retagging people',
    async (sex) => {
      const scripts = await correctedScript();
      const sim = new Simulation({ seed: 7, content: testContent(), missions: scripts.corrected });
      const home = sim.world.create();
      sim.world.add(home, Building, { buildingType: 1, tribe: 1, built: ONE, level: 0 });
      const adults = Array.from({ length: 6 }, (_, n) => person(sim, 6, 0, 10 + n, home));
      const mother = adults[0];
      if (mother === undefined) throw new Error('missing mother');
      const originalBaby = person(sim, 1, 0, 3, home);
      sim.enqueueSetup({ kind: 'setMissionsEnabled', enabled: true });
      sim.step();
      expect(sim.world.get(originalBaby, Owner).player).toBe(1);
      expect(sim.missionBriefingHistory()).toEqual([]); // Six housed nearby adults and the transferred baby cannot pass.
      // Recreate the same housed six adults under the original script: its aggregate gate falsely passes.
      const original = new Simulation({ seed: 7, content: testContent(), missions: scripts.original });
      const originalHome = original.world.create();
      original.world.add(originalHome, Building, { buildingType: 1, tribe: 1, built: ONE, level: 0 });
      for (let n = 0; n < 6; n++) person(original, 6, 0, 10 + n, originalHome);
      person(original, 1, 0, 3, originalHome);
      original.enqueueSetup({ kind: 'setMissionsEnabled', enabled: true });
      original.step();
      expect(original.missionBriefingHistory()).toEqual([5]);

      sim.world.mut(mother, Position).x = fx.fromInt(500);
      sim.world.mut(mother, Position).y = fx.fromInt(500);
      const newborn = spawnNewborn(sim.world, sim.content, mother, home, sex, sim.names, sim.tick);
      sim.world.add(newborn, Resting, { at: home }); // An indoor newborn away from the old coordinate still qualifies.
      sim.world.add(newborn, MissionObjectId, { id: 99 });
      sim.run(36);
      expect(sim.missionBriefingHistory()).toEqual([5]);
      expect(sim.world.get(originalBaby, MissionObjectId).id).toBe(3);
      expect(sim.world.get(newborn, MissionObjectId).id).toBe(99);
      expect(adults.map((e) => sim.world.get(e, MissionObjectId).id)).toEqual([10, 11, 12, 13, 14, 15]);
    },
  );
});
