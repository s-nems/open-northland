import type { ContentIr, JobGraphicsRow } from '../ir/rows.js';
import { CHARACTER_SPEC_ENTRIES, type CharacterSpecId } from './character-specs.js';

/**
 * The bob sets one tribe composes a character look from: the `[jobbasegraphics]` record's body and head
 * bob stems (without palette) plus the palettes that colour them when the recolourable atlases are absent.
 */
export interface TribeLook {
  /** The `logicjob` of the record this look came from - the key its own clip names are authored under. */
  readonly job: number;
  /** The body bob stem, e.g. `cr_hum_body_30`. */
  readonly bodyBmd: string;
  /** The body's shadow bob stem (`cr_hum_body_30_s`), when the record names one. Its silhouettes
   *  parallel the body's own bob ids. */
  readonly shadowBmd?: string;
  /** The head-look stems in `gfxbobmanagerhead` slot order, deduplicated; empty for a body-only look. */
  readonly headBmds: readonly string[];
  readonly bodyPalette: string;
  readonly headPalette: string;
}

/** What a record with no `gfxpalettebasebody` falls to: the skin most records name outright and the same
 *  floor the BMD pipeline decodes such bodies with. `gfxpaletterandom` remains a runtime tint range rather
 *  than a base bob palette; until that composition is supported, this keeps its unique body drawable. */
const DEFAULT_PALETTE = 'test_human_00';

/** The bob-set prefixes of the human and the animal body libraries. Some monster jobs draw a person on an
 *  animal body. */
const HUMAN_BODY_PREFIX = 'cr_hum_';
const ANIMAL_BODY_PREFIX = 'cr_ani_';

/** Whether a bob stem, or a served atlas stem, is an animal body. The pipeline decodes the recolourable
 *  `.indexed` atlas for the human bobs alone, so an animal body is served in its baked skins only. */
export function isAnimalBody(stem: string): boolean {
  return stem.startsWith(ANIMAL_BODY_PREFIX);
}

/** `data/engine2d/bin/bobs/cr_hum_body_30.bmd` → `cr_hum_body_30`. */
function bobStem(bmd: string): string {
  return bmd.slice(bmd.lastIndexOf('/') + 1).replace(/\.bmd$/i, '');
}

/** One `[jobbasegraphics]` record's bob sets, whatever body library it names. */
export function lookFrom(row: JobGraphicsRow): TribeLook {
  const heads: string[] = [];
  for (const head of row.heads) {
    const stem = bobStem(head);
    if (!heads.includes(stem)) heads.push(stem);
  }
  return {
    job: row.job,
    bodyBmd: bobStem(row.body),
    ...(row.shadowBody !== undefined ? { shadowBmd: bobStem(row.shadowBody) } : {}),
    headBmds: heads,
    bodyPalette: row.bodyPalette ?? DEFAULT_PALETTE,
    headPalette: row.headPalette ?? DEFAULT_PALETTE,
  };
}

/**
 * One tribe's looks per character spec, from the `[jobbasegraphics]` rows: each spec names the jobs whose
 * record draws it, best first, so the list degrades from the soldier class to the tribe's plain soldier.
 * The caller takes the first whose bobs are actually decoded, since a record can name a body the pipeline
 * emits no atlas for. A spec with no playable body in its chain keeps no entry, and
 * its jobs then draw the base tribe's look for the same job.
 */
export function tribeLooks(ir: ContentIr | null, tribe: number): Map<CharacterSpecId, TribeLook[]> {
  const byJob = new Map<number, JobGraphicsRow>();
  for (const row of ir?.jobGraphics ?? []) {
    if (row.tribe === tribe && !byJob.has(row.job)) byJob.set(row.job, row);
  }
  const looks = new Map<CharacterSpecId, TribeLook[]>();
  for (const [specId, spec] of CHARACTER_SPEC_ENTRIES) {
    const chain = spec.gfxJobs.flatMap((job) => {
      const row = byJob.get(job);
      if (row === undefined) return [];
      const look = lookFrom(row);
      return look.bodyBmd.startsWith(HUMAN_BODY_PREFIX) || isAnimalBody(look.bodyBmd) ? [look] : [];
    });
    if (chain.length > 0) looks.set(specId, chain);
  }
  return looks;
}

/** The served atlas stem of a look's bob set: `<stem>.<palette>`, the pipeline's naming. */
export function lookStem(bmd: string, palette: string): string {
  return `${bmd}.${palette}`;
}
