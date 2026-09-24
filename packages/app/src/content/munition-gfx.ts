import type { ParticleGfx } from '@open-northland/data';
import type { MunitionBinding, ParticleRef } from '@open-northland/render';
import { servedAtlasStem } from './ir/joins.js';
import type { ContentIr } from './ir/rows.js';

/** The particle the engine raises where a `createsmoke` weapon's shot lands: it names this record
 *  itself rather than through any table (original behavior). */
export const IMPACT_SMOKE_PARTICLE = 'Smoke.org';

function particleRef(record: ParticleGfx): ParticleRef | undefined {
  const layer = servedAtlasStem(record);
  if (layer === undefined || record.frames.length === 0) return undefined;
  const valencies: number[][] = [];
  for (const { valency, bobIds } of record.frames) valencies[valency] = bobIds;
  return {
    layer,
    valencies: Array.from(valencies, (frames) => frames ?? []),
    loop: record.loop,
    directional: record.valencyIsDirection,
  };
}

/** The shot sprite of every munition, the puff it leaves behind (its `spawnParticle`, when that is not
 *  the shot itself), and the landing smoke, before the atlas load decides which ones bind. */
export function resolveMunitionRefs(ir: ContentIr | null): MunitionBinding {
  const particles = ir?.particles ?? [];
  const byMunition: Record<number, ParticleRef> = {};
  const trailByMunition: Record<number, ParticleRef> = {};
  for (const record of particles) {
    if (record.munitionType === undefined) continue;
    const shot = particleRef(record);
    if (shot === undefined) continue;
    byMunition[record.munitionType] ??= shot;
    const spawned = record.spawnParticle === undefined ? undefined : particles[record.spawnParticle];
    const trail = spawned === undefined || spawned === record ? undefined : particleRef(spawned);
    if (trail !== undefined) trailByMunition[record.munitionType] ??= trail;
  }
  const smokeRecord = particles.find((p) => p.name === IMPACT_SMOKE_PARTICLE);
  const impactSmoke = smokeRecord === undefined ? undefined : particleRef(smokeRecord);
  return { byMunition, trailByMunition, ...(impactSmoke !== undefined ? { impactSmoke } : {}) };
}

export function munitionAtlasStems(refs: MunitionBinding): Set<string> {
  const stems = new Set<string>();
  for (const ref of Object.values(refs.byMunition)) stems.add(ref.layer);
  for (const ref of Object.values(refs.trailByMunition)) stems.add(ref.layer);
  if (refs.impactSmoke !== undefined) stems.add(refs.impactSmoke.layer);
  return stems;
}

/** The binding over exactly the sprites whose atlas loaded; `undefined` when no shot sprite did, so a
 *  shot draws the placeholder marker. */
export function buildMunitionBinding(
  refs: MunitionBinding,
  loaded: ReadonlySet<string>,
): MunitionBinding | undefined {
  const keep = (byType: Readonly<Record<number, ParticleRef>>): Record<number, ParticleRef> =>
    Object.fromEntries(Object.entries(byType).filter(([, ref]) => loaded.has(ref.layer)));
  const byMunition = keep(refs.byMunition);
  if (Object.keys(byMunition).length === 0) return undefined;
  const impactSmoke =
    refs.impactSmoke !== undefined && loaded.has(refs.impactSmoke.layer) ? refs.impactSmoke : undefined;
  return {
    byMunition,
    trailByMunition: keep(refs.trailByMunition),
    ...(impactSmoke !== undefined ? { impactSmoke } : {}),
  };
}
