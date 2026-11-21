import { existsSync, readFileSync } from 'node:fs';
import type { MapMission } from '@open-northland/data';
import { components, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { ATTACK_ATOMIC } from '../../../src/catalog/atomics.js';
import {
  DRAGON_HITPOINTS,
  MONSTER_TRIBE_DRAGON,
  NATURAL_WEAPON_TYPE,
} from '../../../src/catalog/creatures.js';
import { JOB_HERO_SWORD, JOB_SOLDIER_UNARMED } from '../../../src/catalog/jobs.js';
import { type AuthoredJoinRows, resolveMissionScript } from '../../../src/game/world/index.js';
import { hasRealIr, loadContentUnderTest, rawIrUnderTest } from '../helpers.js';
import { realMapPath, realMapScript, realMapWorld } from '../real-map-world.js';

const { Health, Settler, Stance } = components;

/** The trades and weapon types our data pack retires: the sabre and axe soldiers and the axe hero. */
const RETIRED_JOBS: readonly number[] = [36, 37, 38, 39, 46];
const RETIRED_WEAPON_TYPES: readonly number[] = [10, 11, 15];
const ANIMAL_COLUMN = '8';
const MONSTER_COLUMN = '9';
const NATION_TRIBES: readonly number[] = [1, 2, 3, 4, 7];
const FRANK = 2;
/** What each weapon did to a weresnake or werewolf in the original, which wore leather there. */
const ORIGINAL_MONSTER_DAMAGE: Readonly<Record<string, number>> = {
  fist: 229,
  woman_fist: 229,
  hero_fist: 229,
  wooden_spear: 1400,
  iron_spear: 2121,
  short_sword: 850,
  long_sword: 2900,
  short_bow: 150,
  long_bow: 400,
  hunter_bow: 500,
  house_bow: 85,
  catapult: 5486,
  hero_spear: 1886,
  hero_sword: 2229,
  hero_saber: 1857,
  hero_bow: 857,
};
const SPEAR_MAIN_TYPE = 2;
/** The dragon's natural weapon: the Byzantine wooden spear values the pack carried before the pool. */
const DRAGON_WEAPON = {
  mainType: SPEAR_MAIN_TYPE,
  weight: 1,
  minRange: 1,
  maxRange: 3,
  damage: { '0': 500, '1': 250, '2': 318, '3': 125, '4': 125, '6': 85, '7': 215, '8': 375, '9': 375 },
};
const DRAGON_ATTACK_TICKS = 59;
const DRAGON_BLOWS = 5;

/** The saga map whose tribute buys Byzantine wooden spearmen, the 8th Wonder map that places them, and the
 *  community map that places nameless axe heroes. */
const TRIBUTE_MAP = 'saga-campaign_04_01';
const DRAGON_MAP = 'wonder-campaign_03_02';
const AXE_HERO_MAP = 'upadek_krola';

interface MapHuman {
  readonly tribe: string;
  readonly role: string;
}

function mapHumans(mapId: string): readonly MapHuman[] {
  const map = JSON.parse(readFileSync(realMapPath(mapId), 'utf8')) as { entities: { humans: MapHuman[] } };
  return map.entities.humans;
}

function settlersOf(sim: Awaited<ReturnType<typeof realMapWorld>>['sim']) {
  return [...sim.world.query(Settler)].map((e) => ({ e, ...sim.world.get(e, Settler) }));
}

describe.runIf(hasRealIr())('the dragon tribe and the retired trades in our data pack', () => {
  it('declares the dragon with its own body, its spear row and a 59-tick five-blow attack', async () => {
    const { merge } = await loadContentUnderTest();
    const { content } = merge;
    const dragon = content.tribes.find((tribe) => tribe.typeId === MONSTER_TRIBE_DRAGON);
    expect(dragon?.id).toBe('dragon');
    expect(dragon?.monster).toEqual({ hitpoints: DRAGON_HITPOINTS });
    expect(dragon?.permissions?.job).toEqual([JOB_SOLDIER_UNARMED]);

    const look = (
      rawIrUnderTest() as { jobGraphics: { tribe: number; job: number; body: string; heads: [] }[] }
    ).jobGraphics.find((row) => row.tribe === MONSTER_TRIBE_DRAGON && row.job === JOB_SOLDIER_UNARMED);
    expect(look?.body).toContain('cr_hum_body_72');
    expect(look?.heads).toEqual([]);

    const clipName = dragon?.atomicBindings.find(
      (b) => b.jobType === JOB_SOLDIER_UNARMED && b.atomicId === ATTACK_ATOMIC,
    )?.animation;
    const clip = content.atomicAnimations.find((a) => a.name === clipName);
    expect(clip?.length).toBe(DRAGON_ATTACK_TICKS);
    expect(clip?.events.filter((e) => e.type === systems.ATOMIC_EVENT_TYPE_ATTACK)).toHaveLength(
      DRAGON_BLOWS,
    );

    const rows = content.weapons.filter((w) => w.tribeType === MONSTER_TRIBE_DRAGON);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      typeId: NATURAL_WEAPON_TYPE,
      jobType: JOB_SOLDIER_UNARMED,
      ...DRAGON_WEAPON,
    });
  });

  it('drops the retired trades and weapons, and gives every weapon row its monster column', async () => {
    const { merge } = await loadContentUnderTest();
    const { content } = merge;
    expect(content.jobs.filter((job) => RETIRED_JOBS.includes(job.typeId))).toEqual([]);
    expect(content.weapons.filter((w) => RETIRED_WEAPON_TYPES.includes(w.typeId))).toEqual([]);
    const ir = rawIrUnderTest() as { jobGraphics: { job: number }[] };
    expect(ir.jobGraphics.filter((row) => RETIRED_JOBS.includes(row.job))).toEqual([]);
    // The Frankish hero bow keeps its own weak row; it and every monster and animal row repeat column 8.
    const expected = (w: (typeof content.weapons)[number]) =>
      w.tribeType !== undefined &&
      NATION_TRIBES.includes(w.tribeType) &&
      !(w.tribeType === FRANK && w.id === 'hero_bow')
        ? ORIGINAL_MONSTER_DAMAGE[w.id]
        : w.damage[ANIMAL_COLUMN];
    const wrong = content.weapons.filter(
      (w) => expected(w) === undefined || w.damage[MONSTER_COLUMN] !== expected(w),
    );
    expect(wrong.map((w) => `${w.tribeType}:${w.id}`)).toEqual([]);
  });

  it.runIf(existsSync(realMapPath(TRIBUTE_MAP)))(
    "spawns the saga tribute's wooden spearmen as dragons",
    () => {
      const script = realMapScript(TRIBUTE_MAP);
      if (script === null) throw new Error(`${TRIBUTE_MAP} ships no script`);
      const authored = (missions: readonly MapMission[]) =>
        missions
          .flatMap((m) => m.results)
          .filter((r) => r.values[0] === 'SetHuman' && r.values[3] === 'soldier_spear_wooden');
      expect(authored(script.missions).length).toBeGreaterThan(0);
      const { script: joined } = resolveMissionScript(script.missions, rawIrUnderTest() as AuthoredJoinRows);
      const spawns = joined.missions.flatMap((m) => m.results).filter((r) => r.opcode === 'SetHuman');
      const dragons = spawns.filter((r) => r.tribe === MONSTER_TRIBE_DRAGON);
      expect(dragons).toHaveLength(authored(script.missions).length);
      for (const spawn of dragons) expect(spawn.job).toBe(JOB_SOLDIER_UNARMED);
    },
  );

  it.runIf(existsSync(realMapPath(DRAGON_MAP)))(
    'places the 8th Wonder map dragons as the dragon tribe, 20000 hitpoints and defending',
    async () => {
      const placed = mapHumans(DRAGON_MAP).filter(
        (h) => h.tribe === 'byzantine' && h.role === 'soldier_spear_wooden',
      ).length;
      expect(placed).toBeGreaterThan(0);
      const { sim } = await realMapWorld({ mapId: DRAGON_MAP, machineSeats: [] });
      const dragons = settlersOf(sim).filter((s) => s.tribe === MONSTER_TRIBE_DRAGON);
      expect(dragons).toHaveLength(placed);
      for (const { e, jobType } of dragons) {
        expect(jobType).toBe(JOB_SOLDIER_UNARMED);
        expect(sim.world.get(e, Health).max).toBe(DRAGON_HITPOINTS);
        expect(sim.world.get(e, Stance).mode).toBe(systems.MILITARY_MODE.DEFEND);
      }
    },
  );

  it.runIf(existsSync(realMapPath(AXE_HERO_MAP)))('places the nameless axe heroes as Bjarni', async () => {
    const bjarni = mapHumans(AXE_HERO_MAP).filter((h) => /^hero_(axe|sword_bjarni)/i.test(h.role)).length;
    expect(bjarni).toBeGreaterThan(0);
    const { sim } = await realMapWorld({ mapId: AXE_HERO_MAP, machineSeats: [] });
    const jobs = settlersOf(sim).map((s) => s.jobType);
    expect(jobs.filter((job) => job === JOB_HERO_SWORD)).toHaveLength(bjarni);
    expect(jobs.filter((job) => job !== null && RETIRED_JOBS.includes(job))).toEqual([]);
  });
});
