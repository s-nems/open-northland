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
  /** The head-look stems in `gfxbobmanagerhead` slot order, deduplicated; empty for a body-only look. */
  readonly headBmds: readonly string[];
  readonly bodyPalette: string;
  readonly headPalette: string;
}

/** What a record with no `gfxpalettebasebody` falls to: the skin 52 of the 71 records name outright. The
 *  four that leave it unnamed name only a `gfxpaletterandom` - the two byzantine `grizzu` bodies, which the
 *  pipeline emits no atlas for at all, and the byzantine and frank job-40 records on the plain soldier
 *  body, which this default resolves correctly. */
const DEFAULT_PALETTE = 'test_human_00';

/** The bob-set prefix of the human bodies. A `[jobbasegraphics]` record may name an animal body instead -
 *  the weresnake and bear jobs name `cr_ani_body_00` - whose clips live outside the human sequence table. */
const HUMAN_BODY_PREFIX = 'cr_hum_';

/** `data/engine2d/bin/bobs/cr_hum_body_30.bmd` → `cr_hum_body_30`. */
function bobStem(bmd: string): string {
  return bmd.slice(bmd.lastIndexOf('/') + 1).replace(/\.bmd$/i, '');
}

function lookFrom(row: JobGraphicsRow): TribeLook {
  const heads: string[] = [];
  for (const head of row.heads) {
    const stem = bobStem(head);
    if (!heads.includes(stem)) heads.push(stem);
  }
  return {
    job: row.job,
    bodyBmd: bobStem(row.body),
    headBmds: heads,
    bodyPalette: row.bodyPalette ?? DEFAULT_PALETTE,
    headPalette: row.headPalette ?? DEFAULT_PALETTE,
  };
}

/**
 * One tribe's looks per character spec, from the `[jobbasegraphics]` rows: each spec names the jobs whose
 * record draws it, best first, so the list degrades from the soldier class to the tribe's plain soldier.
 * The caller takes the first whose bobs are actually decoded, since a record can name a body the pipeline
 * emits no atlas for (the byzantine spearman). A spec with no human body in its chain keeps no entry, and
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
      return look.bodyBmd.startsWith(HUMAN_BODY_PREFIX) ? [look] : [];
    });
    if (chain.length > 0) looks.set(specId, chain);
  }
  return looks;
}

/** The served atlas stem of a look's bob set: `<stem>.<palette>`, the pipeline's naming. */
export function lookStem(bmd: string, palette: string): string {
  return `${bmd}.${palette}`;
}
