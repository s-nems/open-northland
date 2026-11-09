import {
  type FootfallBinding,
  type FootfallGround,
  footfallGround,
  type SceneTerrain,
} from '@open-northland/render';
import type { ContentIr } from '../ir/rows.js';
import { particleRef } from './particles.js';

/** Original behavior: the prints are `particeleffects.cif` logic types 2 and 3, and the dust is the
 *  `Smoke.org` record the engine names itself. */
const FOOTFALL_PARTICLES = { snowSteps: 'SnowSteps', beachSteps: 'beachSteps', dust: 'Smoke.org' } as const;

export function resolveFootfall(ir: ContentIr | null): FootfallBinding {
  const named = (name: string) => {
    const record = ir?.particles?.find((p) => p.name === name);
    return record === undefined ? undefined : particleRef(record);
  };
  return {
    snowSteps: named(FOOTFALL_PARTICLES.snowSteps),
    beachSteps: named(FOOTFALL_PARTICLES.beachSteps),
    dust: named(FOOTFALL_PARTICLES.dust),
  };
}

export function loadedFootfall(refs: FootfallBinding, loaded: ReadonlySet<string>): FootfallBinding {
  const keep = <T extends { readonly layer: string }>(ref: T | undefined) =>
    ref !== undefined && loaded.has(ref.layer) ? ref : undefined;
  return { snowSteps: keep(refs.snowSteps), beachSteps: keep(refs.beachSteps), dust: keep(refs.dust) };
}

/** The footfall of a decoded map's cells, its ground patterns joined `gfxPatterns` by name to their
 *  logic type; `null` without a ground lane or on ground that leaves nothing. */
export function mapFootfallGround(
  terrain: SceneTerrain,
  patterns: readonly { readonly editName?: string | undefined; readonly logicType: number }[],
): FootfallGround | null {
  const ground = terrain.ground;
  if (ground === undefined) return null;
  const logicTypeByName = new Map(patterns.map((p) => [p.editName, p.logicType]));
  const logicTypes = ground.patterns.map((name) => logicTypeByName.get(name));
  return footfallGround(ground, logicTypes, terrain.width, terrain.height);
}
