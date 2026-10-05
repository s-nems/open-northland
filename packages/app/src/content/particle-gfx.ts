import type { ParticleGfx } from '@open-northland/data';
import type { ParticleRef } from '@open-northland/render';
import { servedAtlasStem } from './ir/joins.js';

export function particleRef(record: ParticleGfx): ParticleRef | undefined {
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
