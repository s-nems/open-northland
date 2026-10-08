import { type ConstructionSupply, TICKS_PER_SECOND, type WorldSnapshot } from '@open-northland/sim';
import { isPalisade, isRoadSite, ownerPlayerOf, type SnapshotEntity } from '../../../game/snapshot.js';
import { entitiesUnder, idsGroupedBy } from '../../../game/snapshot-id-index.js';
import { type MessageNaming, type MessageRaiser, nodeOf } from './raise.js';
import { USER_MESSAGE_TYPE } from './types.js';
import type { StatusAsks, StatusRead } from './work-asks.js';

/**
 * Ticks a building site must lack a good that nothing in its reach holds and nobody brings it before
 * its note: a workshop's next unit, or a load a carrier is about to pick up, clears a shorter gap on its
 * own. Approximation.
 */
export const CONSTRUCTION_SHORTAGE_GRACE_TICKS = 45 * TICKS_PER_SECOND;

/** What the shortage notes read about the seat's unfinished sites. */
export interface SiteSeam {
  readonly supply: StatusRead<ConstructionSupply | undefined>;
}

/** The good a site's note names, null for no shortage, undefined while not judged yet. */
export type ShortageVerdict = number | null | undefined;

/** Read side for the retire rules. */
export interface ShortageReader {
  verdict(site: number): ShortageVerdict;
}

/** The seat's sites still going up, buildings, wall segments and road sites alike, by owner. */
const UNFINISHED_SITES = idsGroupedBy(
  (e) => (e.components.UnderConstruction !== undefined ? ownerPlayerOf(e) : undefined),
  'unfinished sites by owner',
  { values: ['Owner'], presence: ['UnderConstruction'] },
);

export function unfinishedSitesOf(snapshot: WorldSnapshot, owner: number): readonly SnapshotEntity[] {
  return entitiesUnder(snapshot, UNFINISHED_SITES, owner);
}

/** One site's watch: since when it lacks a good nobody holds or brings, null while it lacks none, the
 *  verdict, and whether this site's note is the one raised for it (a wall or road run shares one). */
interface Watch {
  unheldSince: number | null;
  verdict: ShortageVerdict;
  voiced: boolean;
}

/** Wall segments and road sites short of one good share one note per kind and good: a palisade is many
 *  sites to the sim and one job to the player. A building site has a note of its own. */
function sharedNoteKey(site: SnapshotEntity, goodType: number): string | null {
  if (isPalisade(site)) return `wall:${goodType}`;
  if (isRoadSite(site)) return `road:${goodType}`;
  return null;
}

/**
 * The seat's sites short of a material the player has to supply: a line of the bill that no store of the
 * seat or neutral pile holds in the site's signpost reach and nobody is bringing, once that has stood
 * {@link CONSTRUCTION_SHORTAGE_GRACE_TICKS}.
 * The note retires as soon as a store in reach holds that good or a load of it is on its way, even
 * while the line is still short: the player fixed what the note asked for. A good that runs dry again
 * earns a new note after another grace, so a good trickling in one unit at a time raises one note a
 * grace at most. A second short good rewords the standing note once the first is held or inbound. The
 * grace is one clock per site, not per good (approximation): a good turning unheld while another's
 * clock runs inherits that clock. The wall segments short of a good share one note, as do the road
 * sites: the one raised last sweep keeps voicing it while its shortage stands, else the first in the
 * index. A sweep visits the seat's unfinished sites off a maintained index.
 */
export class SiteShortages implements ShortageReader {
  private watched = new Map<number, Watch>();
  /** The site voicing each shared note after the last sweep. */
  private voices = new Map<string, number>();
  private swept = false;

  constructor(
    private readonly seat: number,
    private readonly asks: StatusAsks<ConstructionSupply | undefined>,
  ) {}

  /** Judge the unfinished sites and raise a note for each building short of a material, and one for each
   *  good the walls are short of and each the roads are. */
  sweep(snapshot: WorldSnapshot, raiser: MessageRaiser, naming: MessageNaming): void {
    const next = new Map<number, Watch>();
    const shared = new Map<string, SnapshotEntity[]>();
    for (const site of unfinishedSitesOf(snapshot, this.seat)) {
      const watch = this.watched.get(site.id) ?? { unheldSince: null, verdict: undefined, voiced: false };
      next.set(site.id, watch);
      this.judge(snapshot.tick, site.id, watch);
      const verdict = watch.verdict;
      if (verdict === null || verdict === undefined) {
        watch.voiced = false;
        continue;
      }
      const key = sharedNoteKey(site, verdict);
      if (key === null) {
        watch.voiced = true;
        raiseShortage(raiser, naming, site, verdict);
        continue;
      }
      watch.voiced = false;
      const run = shared.get(key);
      if (run === undefined) shared.set(key, [site]);
      else run.push(site);
    }
    const voices = new Map<string, number>();
    for (const [key, run] of shared) {
      const kept = this.voices.get(key);
      const voice = run.find((site) => site.id === kept) ?? run[0];
      if (voice === undefined) continue;
      const watch = next.get(voice.id);
      if (watch === undefined || typeof watch.verdict !== 'number') continue;
      watch.voiced = true;
      voices.set(key, voice.id);
      raiseShortage(raiser, naming, voice, watch.verdict);
    }
    this.voices = voices;
    this.watched = next;
    this.swept = true;
  }

  /** A site's standing shortage, null when it has none or another site voices it. */
  verdict(site: number): ShortageVerdict {
    const watch = this.watched.get(site);
    if (watch === undefined) return this.swept ? null : undefined;
    if (watch.verdict === undefined) return undefined;
    return watch.voiced ? watch.verdict : null;
  }

  private judge(tick: number, site: number, watch: Watch): void {
    // No answer yet keeps the verdict.
    const answer = this.asks.status(site);
    if (answer === undefined) return;
    const supply = answer.status;
    if (supply === undefined || supply.kind === 'covered') {
      watch.unheldSince = null;
      watch.verdict = null;
      return;
    }
    const unheldLines = supply.shortfalls.filter((line) => line.inbound === 0 && !line.held);
    const standing = watch.verdict;
    if (typeof standing === 'number' && unheldLines.some((line) => line.goodType === standing)) return;
    const unheld = unheldLines[0];
    if (unheld === undefined) {
      watch.unheldSince = null;
      watch.verdict = null;
      return;
    }
    watch.unheldSince ??= tick;
    // Within the grace the verdict stays as it was, so a note restored from an earlier mount stands.
    if (tick - watch.unheldSince < CONSTRUCTION_SHORTAGE_GRACE_TICKS) return;
    watch.verdict = unheld.goodType;
  }
}

/** Raise the note about one site short of `goodType`, keyed by the site: a new good rewords the
 *  standing one. */
export function raiseShortage(
  raiser: MessageRaiser,
  naming: MessageNaming,
  site: SnapshotEntity,
  goodType: number,
): void {
  const type = USER_MESSAGE_TYPE.constructionStarved;
  raiser.raise(
    `${type}|building:${site.id}`,
    {
      type,
      subject: { kind: 'building', entity: site.id },
      at: nodeOf(site),
      about: null,
      goodType,
      technologies: null,
      jobType: null,
    },
    () =>
      naming.text(type, {
        subjectName: naming.building(site),
        jobLabel: null,
        goodName: naming.technology('good', goodType) ?? null,
        stanceName: null,
      }),
    true,
  );
}
