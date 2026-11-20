import type { MapModules } from './schema.js';

/** The half-cell lattice is `2W x 2H` over a `W x H` cell map. */
const HALF_CELLS_PER_CELL = 2;

/** A map's size in cells. */
export interface MapCells {
  readonly width: number;
  readonly height: number;
}

/** The content slugs a game knows, by kind. */
export interface MapModulesContentNames {
  readonly jobs: ReadonlySet<string>;
  readonly tribes: ReadonlySet<string>;
  readonly buildings: ReadonlySet<string>;
  readonly goods: ReadonlySet<string>;
  readonly vehicles: ReadonlySet<string>;
}

/** What the caller knows of the map and its content; null skips that check. */
export interface MapModulesKnown {
  /** The map's player seats. */
  readonly seats: ReadonlySet<number> | null;
  readonly names: MapModulesContentNames | null;
}

type ContentKind = keyof MapModulesContentNames;

export const onMap = (size: MapCells, hx: number, hy: number): boolean =>
  hx >= 0 && hy >= 0 && hx < size.width * HALF_CELLS_PER_CELL && hy < size.height * HALF_CELLS_PER_CELL;

/**
 * Throws when the modules do not fit the map they run on: a map point off the map, whose `size` is in
 * cells, a seat the map lacks, or a slug its content lacks. Each means the modules were written for
 * another version of the map or its content.
 */
export function assertMapModulesFitMap(modules: MapModules, size: MapCells, known: MapModulesKnown): void {
  for (const [name, x, y] of pointsOf(modules)) {
    if (!onMap(size, x, y)) throw new Error(`map modules: the ${name} at (${x}, ${y}) lies off the map`);
  }
  const { seats, names } = known;
  if (seats !== null) {
    for (const seat of seatsOf(modules)) {
      if (!seats.has(seat)) throw new Error(`map modules: the map has no seat ${seat}`);
    }
  }
  if (names !== null) {
    for (const [kind, slug] of slugsOf(modules)) {
      if (!names[kind].has(slug)) throw new Error(`map modules: the content lacks ${slug} among its ${kind}`);
    }
  }
}

type Point = readonly [string, number, number];

function pointsOf(modules: MapModules): Point[] {
  const { siege, heroes } = modules;
  const placed = (heroes?.placed ?? []).map((hero): Point => [`seat ${hero.seat}'s hero`, hero.x, hero.y]);
  if (siege === undefined) return placed;
  const { stronghold, attacks, porters } = siege;
  return [
    ['stronghold', stronghold.x, stronghold.y],
    ...attacks.targets.flatMap((target): Point[] => [
      [`seat ${target.seat}'s target`, target.x, target.y],
      ...target.landings.flatMap((landing): Point[] => [
        [`seat ${target.seat}'s landing ship`, landing.spawnX, landing.spawnY],
        [`seat ${target.seat}'s landing shore`, landing.x, landing.y],
      ]),
    ]),
    ...placed,
    ...(porters === undefined ? [] : [["porters' flag", porters.x, porters.y] as const]),
  ];
}

function seatsOf(modules: MapModules): number[] {
  const { siege, gearSchedule, heroes, deathDrops } = modules;
  return [
    ...(siege === undefined
      ? []
      : [siege.stronghold.seat, ...siege.attacks.targets.flatMap((target) => [target.seat, target.raider])]),
    ...(gearSchedule?.seats ?? []),
    ...(heroes?.placed ?? []).map((hero) => hero.seat),
    ...(deathDrops?.withheldSeats ?? []),
  ];
}

function slugsOf(modules: MapModules): (readonly [ContentKind, string])[] {
  const { siege, gearSchedule, heroes } = modules;
  const of = (kind: ContentKind, slugs: readonly string[]) => slugs.map((slug) => [kind, slug] as const);
  return [
    ...(siege === undefined
      ? []
      : [
          ...of('buildings', [siege.stronghold.building]),
          ...of('tribes', [siege.tribe]),
          ...of(
            'jobs',
            siege.jobMix.map((share) => share.job),
          ),
          ...of('jobs', siege.towerGarrison?.slots.map((slot) => slot.job) ?? []),
          ...of('vehicles', siege.landings === undefined ? [] : [siege.landings.vehicle]),
          ...of('vehicles', siege.porters === undefined ? [] : [siege.porters.vehicle]),
        ]),
    ...(gearSchedule?.steps ?? []).flatMap((step) => [
      ...of(
        'goods',
        step.grants.flatMap((grant) => grant.goods),
      ),
      ...of(
        'goods',
        step.weaponUpgrades.flatMap((upgrade) => [upgrade.from, upgrade.to]),
      ),
    ]),
    ...(heroes?.placed ?? []).flatMap((hero) => [
      ...of('jobs', [hero.job]),
      ...of('tribes', [hero.tribe]),
      ...of('goods', hero.equipment),
    ]),
  ];
}
