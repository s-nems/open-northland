import type { BuildingFootprint } from './schema/index.js';

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
}

/** `tribe`'s own footprint for `type`, else the lowest tribe's; an undefined tribe reads the lowest. */
export function buildingFootprintFor<F = BuildingFootprint>(
  type: TribeVariants<F>,
  tribe: number | undefined,
): F | undefined {
  if (tribe === undefined) return type.footprint;
  return type.tribeVariants.find((v) => v.tribe === tribe)?.footprint ?? type.footprint;
}

/** `tribe`'s own max hitpoints for `type`, else the lowest tribe's; an undefined tribe reads the lowest. */
export function buildingHitpointsFor(
  type: TribeVariants<unknown>,
  tribe: number | undefined,
): number | undefined {
  if (tribe === undefined) return type.hitpoints;
  return type.tribeVariants.find((v) => v.tribe === tribe)?.hitpoints ?? type.hitpoints;
}
