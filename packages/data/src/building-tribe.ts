import type { BuildingFootprint, FootprintCell } from './schema/index.js';

/** The slice of a building type its per-tribe values resolve over, generic over the footprint's shape so
 *  a consumer reading only some of its cells can pass a narrower one. */
interface TribeVariants<F> {
  readonly footprint?: F | undefined;
  readonly hitpoints?: number | undefined;
  readonly tribeVariants: readonly {
    readonly tribe: number;
    readonly footprint?: F | undefined;
    readonly hitpoints?: number | undefined;
  }[];
  readonly recordFootprints?:
    | readonly { readonly tribe: number; readonly editName: string; readonly footprint: F }[]
    | undefined;
}

/** `tribe`'s own footprint for `type`, else the lowest tribe's; an undefined tribe reads the lowest. A
 *  `record` names the house record a map placed, whose own footprint wins where it has one. */
export function buildingFootprintFor<F = BuildingFootprint>(
  type: TribeVariants<F>,
  tribe: number | undefined,
  record?: string,
): F | undefined {
  if (tribe === undefined) return type.footprint;
  if (record !== undefined) {
    const records = type.recordFootprints ?? [];
    for (let i = 0; i < records.length; i++) {
      const entry = records[i];
      if (entry?.tribe === tribe && entry.editName === record) return entry.footprint;
    }
  }
  return variantOf(type, tribe)?.footprint ?? type.footprint;
}

/** Whether `record` stands `type` on a footprint of its own for `tribe`. */
export function hasRecordFootprint(type: TribeVariants<unknown>, tribe: number, record: string): boolean {
  return (type.recordFootprints ?? []).some((entry) => entry.tribe === tribe && entry.editName === record);
}

/** `tribe`'s own max hitpoints for `type`, else the lowest tribe's; an undefined tribe reads the lowest. */
export function buildingHitpointsFor(
  type: TribeVariants<unknown>,
  tribe: number | undefined,
): number | undefined {
  if (tribe === undefined) return type.hitpoints;
  return variantOf(type, tribe)?.hitpoints ?? type.hitpoints;
}

/** Whether `type` stands on the same footprint cells for tribe `a`, as house `record` where one is named,
 *  and for tribe `b`. Each variant carries its own footprint object, so the cells are compared, in any
 *  order. */
export function sameBuildingFootprintCells(
  type: TribeVariants<BuildingFootprint>,
  a: number,
  b: number,
  record?: string,
): boolean {
  return footprintKey(buildingFootprintFor(type, a, record)) === footprintKey(buildingFootprintFor(type, b));
}

/** Whether two footprints hold the same cells, door and work area, in any order. */
export function sameFootprintCells(a: BuildingFootprint, b: BuildingFootprint): boolean {
  return footprintKey(a) === footprintKey(b);
}

function footprintKey(footprint: BuildingFootprint | undefined): string {
  if (footprint === undefined) return '';
  const cells = (list: readonly FootprintCell[]): string =>
    list
      .map((cell) => `${cell.dx},${cell.dy}`)
      .sort()
      .join(';');
  const door = footprint.door === undefined ? '' : `${footprint.door.dx},${footprint.door.dy}`;
  return [
    cells(footprint.blocked),
    cells(footprint.familyBody),
    cells(footprint.reserved),
    door,
    cells(footprint.workArea),
  ].join('|');
}

/** `tribe`'s variant of `type`, found without a per-call closure: this runs per building per tick. */
function variantOf<F>(
  type: TribeVariants<F>,
  tribe: number,
): TribeVariants<F>['tribeVariants'][number] | undefined {
  const variants = type.tribeVariants;
  for (let i = 0; i < variants.length; i++) if (variants[i]?.tribe === tribe) return variants[i];
  return undefined;
}
