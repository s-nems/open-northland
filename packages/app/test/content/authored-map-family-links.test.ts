import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ContentSet } from '@open-northland/data';
import { components, type Entity, nodeOfPosition, type Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { contentDir, hasRealIr } from './helpers.js';
import { realMapWorld } from './real-map-world.js';

const { Female, Marriage, Owner, Position, Residence, Settler } = components;

/**
 * The decoded `marry` and `childOfWoman` lines of real maps, through the map entry's own world build:
 * the couples a map places start married in one home, and a placed baby starts as their child.
 */

/** Seat 0 places two women and, later, two builders, each `marry` line written after both spouses. */
const INVASION_MAP = 'wielka_inwazja';
const INVASION_SEAT = 0;
const INVASION_HOME = { hx: 395, hy: 314 };
/** Its `childOfWoman` names a baby and a woman married by the line before it. */
const TUTORIAL_MAP = 'tutorial_002';
const TUTORIAL_HOME = { hx: 88, hy: 192 };
/** Its one `marry` names the man first, which weds no one. */
const MAN_FIRST_MAP = 'saracen_1';

const BUILDER = 'builder';
const BABY_FEMALE = 'baby_female';
const REAL_MAP_TIMEOUT_MS = 60_000;

function jobId(content: ContentSet, sim: Simulation, e: Entity): string | undefined {
  const jobType = sim.world.get(e, Settler).jobType;
  return content.jobs.find((j) => j.typeId === jobType)?.id;
}

function anchorOf(sim: Simulation, building: Entity | undefined): { hx: number; hy: number } | undefined {
  if (building === undefined) return undefined;
  const p = sim.world.get(building, Position);
  return nodeOfPosition(p.x, p.y);
}

function wivesOf(sim: Simulation, seat?: number): Entity[] {
  return [...sim.world.query(Marriage, Female)].filter(
    (e) => seat === undefined || sim.world.tryGet(e, Owner)?.player === seat,
  );
}

describe.runIf(hasRealIr() && existsSync(resolve(contentDir(), 'maps')))(
  'authored decoded-map families',
  () => {
    it(
      `${INVASION_MAP}: seat ${INVASION_SEAT} starts with its two couples married in their home`,
      async () => {
        const { sim, content } = await realMapWorld({ mapId: INVASION_MAP, aiSeats: [] });
        const wives = wivesOf(sim, INVASION_SEAT);
        expect(wives).toHaveLength(2);
        for (const wife of wives) {
          const husband = sim.world.get(wife, Marriage).spouse;
          expect(jobId(content, sim, husband)).toBe(BUILDER);
          expect(sim.world.get(husband, Marriage).spouse).toBe(wife);
          const home = sim.world.tryGet(wife, Residence)?.home;
          expect(anchorOf(sim, home)).toEqual(INVASION_HOME);
          expect(sim.world.tryGet(husband, Residence)?.home).toBe(home);
        }
      },
      REAL_MAP_TIMEOUT_MS,
    );

    it(
      `${TUTORIAL_MAP}: the placed baby starts as the child of the couple the map weds`,
      async () => {
        const { sim, content } = await realMapWorld({ mapId: TUTORIAL_MAP, aiSeats: [] });
        const mother = wivesOf(sim).find((e) => sim.world.get(e, Marriage).child !== null);
        expect(mother).toBeDefined();
        if (mother === undefined) return;
        const { spouse, child } = sim.world.get(mother, Marriage);
        expect(child).not.toBeNull();
        if (child === null) return;
        expect(jobId(content, sim, child)).toBe(BABY_FEMALE);
        expect(sim.world.get(spouse, Marriage).child).toBe(child);
        const home = sim.world.tryGet(mother, Residence)?.home;
        expect(anchorOf(sim, home)).toEqual(TUTORIAL_HOME);
        expect(sim.world.tryGet(child, Residence)?.home).toBe(home);
      },
      REAL_MAP_TIMEOUT_MS,
    );

    it(
      `${MAN_FIRST_MAP}: a line naming the man first weds no one`,
      async () => {
        const { sim } = await realMapWorld({ mapId: MAN_FIRST_MAP, aiSeats: [] });
        expect(wivesOf(sim)).toEqual([]);
      },
      REAL_MAP_TIMEOUT_MS,
    );
  },
);
