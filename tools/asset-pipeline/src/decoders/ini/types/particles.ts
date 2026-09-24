import { ParticleGfx } from '@open-northland/data';
import type { BmdPaletteBinding } from '../bindings/bmd-palette.js';
import { readBmdPaletteBindings } from '../bindings/bmd-palette.js';
import type { RuleSection } from '../grammar.js';
import { getPaletteName, makeSource, normalizeOptionalPath, type SourceRef } from '../ir-fields.js';
import { getInt, getIntRows, getStr } from '../props.js';

/** The file writes the section header both `[Particel]` and `[particel]`. */
const PARTICLE_SECTION = 'particel';

function isParticleSection(sec: RuleSection): boolean {
  return sec.name.toLowerCase() === PARTICLE_SECTION;
}

/**
 * Every `[particel]` record keeps its slot: {@link ParticleGfx.index} is positional, the key a record's
 * `spawnparticelId` names, so an artless one is kept rather than skipped.
 */
export function extractParticles(sections: readonly RuleSection[], src: SourceRef): ParticleGfx[] {
  const records: ParticleGfx[] = [];
  let index = 0;
  for (const sec of sections) {
    if (!isParticleSection(sec)) continue;
    const frames = getIntRows(sec, 'gfxframes', (n) => n >= 2).map((vals) => ({
      valency: vals[0] as number,
      bobIds: vals.slice(1),
    }));
    records.push(
      ParticleGfx.parse({
        index,
        name: getStr(sec, 'name') ?? `particle_${index}`,
        bmd: normalizeOptionalPath(getStr(sec, 'bobmanager')),
        paletteName: getPaletteName(sec, 'palette'),
        frames,
        loop: getInt(sec, 'animloop') === 1,
        valencyIsDirection: getInt(sec, 'valencyisdirection') === 1,
        munitionType: getInt(sec, 'munitiontype'),
        spawnParticle: getInt(sec, 'spawnparticelId'),
        source: makeSource(src, PARTICLE_SECTION),
      }),
    );
    index++;
  }
  return records;
}

/** The `(bmd, palette)` atlases the particle records draw from. */
export function extractParticleGraphics(sections: readonly RuleSection[]): BmdPaletteBinding[] {
  return sections
    .filter(isParticleSection)
    .flatMap((sec) => readBmdPaletteBindings(sec, 'bobmanager', 'palette'));
}
