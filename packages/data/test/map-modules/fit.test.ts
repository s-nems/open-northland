import { describe, expect, it } from 'vitest';
import {
  assertMapModulesFitMap,
  MAP_VARIANTS,
  type MapModules,
  type MapModulesContentNames,
} from '../../src/index.js';

/** In cells: a 20 x 10 half-cell grid. */
const SIZE = { width: 10, height: 5 };
const committed = MAP_VARIANTS.find((row) => row.modules?.siege !== undefined)?.modules;
if (committed?.siege === undefined) throw new Error('no committed siege to vary');
const modules: MapModules = committed;
const siege = committed.siege;
const [firstTarget] = siege.attacks.targets;
if (firstTarget === undefined) throw new Error('no committed target to vary');
const target = firstTarget;
const onMap = { x: 1, y: 1 };
const landing = { spawnX: 1, spawnY: 1, ...onMap };
const off = { x: 20, y: 0 };

type Siege = NonNullable<MapModules['siege']>;

/** The committed modules moved onto the small map, their siege changed by `change`. */
function fitted(change: (fit: Siege) => Siege = (fit) => fit, heroAt = onMap): MapModules {
  const fit: Siege = {
    ...siege,
    stronghold: { ...siege.stronghold, ...onMap },
    attacks: { ...siege.attacks, targets: [{ ...target, ...onMap, landings: [landing] }] },
    ...(siege.porters === undefined ? {} : { porters: { ...siege.porters, ...onMap } }),
  };
  const heroes = modules.heroes;
  return {
    ...modules,
    siege: change(fit),
    ...(heroes === undefined
      ? {}
      : { heroes: { ...heroes, placed: heroes.placed.map((h) => ({ ...h, ...heroAt })) } }),
  };
}

/** A map's sixteen seats, so every seat the committed modules name is on it. */
const SEAT_COUNT = 16;
const SEATS = new Set(Array.from({ length: SEAT_COUNT }, (_, seat) => seat));
const nameSet = (...slugs: (string | undefined)[]) =>
  new Set(slugs.flatMap((s) => (s === undefined ? [] : [s])));
/** Every slug the committed modules name. */
const NAMES: MapModulesContentNames = {
  jobs: nameSet(
    ...siege.jobMix.map((row) => row.job),
    ...(siege.towerGarrison?.slots.map((row) => row.job) ?? []),
  ),
  tribes: nameSet(siege.tribe, ...(modules.heroes?.placed.map((hero) => hero.tribe) ?? [])),
  buildings: nameSet(siege.stronghold.building),
  goods: nameSet(
    ...(modules.gearSchedule?.steps.flatMap((step) => [
      ...step.grants.flatMap((grant) => grant.goods),
      ...step.weaponUpgrades.flatMap((row) => [row.from, row.to]),
    ]) ?? []),
    ...(modules.heroes?.placed.flatMap((hero) => hero.equipment) ?? []),
  ),
  vehicles: nameSet(siege.landings?.vehicle, siege.porters?.vehicle),
};
const KNOWN = { seats: SEATS, names: NAMES };

describe('assertMapModulesFitMap', () => {
  it('passes modules whose points, seats and slugs all fit', () => {
    expect(() => assertMapModulesFitMap(fitted(), SIZE, KNOWN)).not.toThrow();
  });

  it('refuses a map point off the map', () => {
    const offPoints = [
      fitted((fit) => ({ ...fit, stronghold: { ...fit.stronghold, ...off } })),
      fitted((fit) => ({
        ...fit,
        attacks: { ...fit.attacks, targets: [{ ...target, ...off, landings: [] }] },
      })),
      fitted((fit) => ({
        ...fit,
        attacks: {
          ...fit.attacks,
          targets: [{ ...target, ...onMap, landings: [{ ...landing, spawnX: off.x, spawnY: off.y }] }],
        },
      })),
      fitted((fit) => ({
        ...fit,
        attacks: { ...fit.attacks, targets: [{ ...target, ...onMap, landings: [{ ...landing, ...off }] }] },
      })),
      fitted(undefined, off),
      fitted((fit) => (fit.porters === undefined ? fit : { ...fit, porters: { ...fit.porters, ...off } })),
    ];
    for (const moved of offPoints) {
      expect(() => assertMapModulesFitMap(moved, SIZE, KNOWN)).toThrow(/at \(20, 0\) lies off the map/);
    }
  });

  it('refuses a seat the map lacks, unless its seats are unknown', () => {
    const seats = new Set([...SEATS].filter((seat) => seat !== target.raider));
    expect(() => assertMapModulesFitMap(fitted(), SIZE, { ...KNOWN, seats })).toThrow(
      `no seat ${target.raider}`,
    );
    expect(() => assertMapModulesFitMap(fitted(), SIZE, { ...KNOWN, seats: null })).not.toThrow();
  });

  it('refuses a slug the content lacks, unless its names are unknown', () => {
    const names = { ...NAMES, tribes: new Set<string>() };
    expect(() => assertMapModulesFitMap(fitted(), SIZE, { ...KNOWN, names })).toThrow(siege.tribe);
    expect(() => assertMapModulesFitMap(fitted(), SIZE, { ...KNOWN, names: null })).not.toThrow();
  });
});
