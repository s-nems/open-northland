import { type ContentSet, parseContentSet } from '@open-northland/data';
import { VIKING_BUILDINGS } from '../catalog/buildings.js';
import { GATHERING_BALANCE_BY_ID } from '../catalog/gathering.js';
import { NAV_LANDSCAPE_TYPES } from '../catalog/terrain.js';
import { fetchJsonOrNull } from './net.js';

/** The one in-flight/settled parse of the served IR into a `ContentSet` — memoized like {@link loadRealContent}. */
let contentSetPromise: Promise<ContentSet | null> | null = null;

/**
 * Fetch + validate the served `content/ir.json` into the sim's `ContentSet` — the real-content
 * counterpart to {@link import('./ir.js').loadIr}, which returns the graphics/atlas view instead. The
 * pure sim never does I/O, so the validated set is minted here at the app boundary
 * (`packages/app/AGENTS.md`); wiring it into the sim is a later ticket.
 *
 * Returns `null` when `content/` is absent, so a bare checkout still boots; a present-but-malformed IR
 * throws via `parseContentSet` so a genuine schema or cross-reference break surfaces loudly instead of
 * degrading to silence. `fetchImpl` defaults to the global `fetch`; the default path is memoized (the
 * multi-MB IR parses once per page), while an injected transport runs uncached so callers stay
 * independent.
 */
export function loadRealContent(fetchImpl: typeof fetch = fetch): Promise<ContentSet | null> {
  if (fetchImpl !== fetch) return fetchContentSet(fetchImpl);
  contentSetPromise ??= fetchContentSet(fetch).then((set) => {
    // Memoize only success: a transient boot-time fetch failure must not pin the loader to null for
    // the page's lifetime — the next consumer retries (mirrors loadIr).
    if (set === null) contentSetPromise = null;
    return set;
  });
  return contentSetPromise;
}

async function fetchContentSet(fetchImpl: typeof fetch): Promise<ContentSet | null> {
  const raw = await fetchJsonOrNull<unknown>('/ir.json', fetchImpl);
  return raw === null ? null : parseContentSet(raw);
}

/** The real content with its gathering data completed, plus the gaps the clean-room overlay cannot fill. */
export interface RealContentMerge {
  /** The real content readied for the sim: the clean-room felling/mining balance pinned into its zeroed
   *  gathering blocks, and the sim's nav-terrain classes ({@link NAV_LANDSCAPE_TYPES}) added to `landscape`. */
  readonly content: ContentSet;
  /** Gathered goods (they carry a `gathering` block) with no clean-room balance — they stay uncalibrated
   *  (wheat is farmed, and leather/honey/herb/meat are animal/production goods the sandbox never map-gathers). */
  readonly unbalancedGoods: readonly string[];
  /** Real buildings absent from the clean-room catalog (`VIKING_BUILDINGS`) — the wonders/vehicles/special
   *  the sandbox never modelled. They keep their extracted footprint/stock/recipe but no clean-room tuning. */
  readonly uncatalogedBuildings: readonly string[];
}

/**
 * Complete the real content's gathering data and surface what it cannot fill. The pipeline's
 * `extractGoodGathering` emits 0 for chops-to-fell / yield / deposit size / levels (the mod data carries no
 * chop count — `catalog/felling.ts`), so this pins the clean-room balance from the shared
 * {@link GATHERING_BALANCE_BY_ID} (the same table the sandbox reads) into those four fields by the good's
 * string id, preserving everything else real ships (harvest/pickup/store atomics, `bioLandscape`).
 *
 * It is data-completion, not today's felling driver: resource nodes seed from that same balance via the
 * `GATHERERS` table at placement (`game/sandbox/place.ts`, which the re-key aligned to real ids), so real
 * trees already fell. This keeps the ContentSet self-consistent and readies it for a content-driven
 * resource-spawn system. Gathered goods with no clean-room balance, and buildings beyond the clean-room
 * catalog, are reported — not silently dropped — so the caller can log the gap.
 *
 * It also injects the sim's semantic nav-terrain classes ({@link NAV_LANDSCAPE_TYPES}) into `landscape`:
 * real content's detailed types (1..87) don't carry the collision classes a resolved grid
 * (`content/collision.ts`) or a scene grid navigates on, and those class ids sit in a reserved band that
 * never aliases the detailed types, so `buildTerrainGraph` on real content resolves both. Idempotent — a
 * class row already present (a set that already lists them) is not duplicated.
 *
 * `goodNames` (the app-wide `?lang=` good-name map, keyed by good string id) localizes each good's
 * display name — the real IR ships raw ids where the sandbox carried English `name`s; a good the map
 * lacks keeps its own name.
 */
export function mergeRealContent(
  real: ContentSet,
  goodNames?: ReadonlyMap<string, string>,
): RealContentMerge {
  const goods = real.goods.map((raw) => {
    const localized = goodNames?.get(raw.id);
    const good = localized !== undefined ? { ...raw, name: localized } : raw;
    const balance = good.gathering === undefined ? undefined : GATHERING_BALANCE_BY_ID[good.id];
    if (good.gathering === undefined || balance === undefined) return good;
    return {
      ...good,
      gathering: {
        ...good.gathering,
        ...(balance.chopsToFell !== undefined ? { chopsToFell: balance.chopsToFell } : {}),
        ...(balance.yieldPerNode !== undefined ? { yieldPerNode: balance.yieldPerNode } : {}),
        ...(balance.depositSize !== undefined ? { depositSize: balance.depositSize } : {}),
        ...(balance.depositLevels !== undefined ? { depositLevels: balance.depositLevels } : {}),
      },
    };
  });
  const unbalancedGoods = real.goods
    .filter((good) => good.gathering !== undefined && GATHERING_BALANCE_BY_ID[good.id] === undefined)
    .map((good) => good.id);
  const cataloged = new Set(VIKING_BUILDINGS.map((b) => b.id));
  const uncatalogedBuildings = real.buildings.filter((b) => !cataloged.has(b.id)).map((b) => b.id);
  const landscapeIds = new Set(real.landscape.map((t) => t.typeId));
  const navRows = NAV_LANDSCAPE_TYPES.filter((t) => !landscapeIds.has(t.typeId));
  const landscape = [...real.landscape, ...navRows];
  return { content: parseContentSet({ ...real, goods, landscape }), unbalancedGoods, uncatalogedBuildings };
}

/**
 * Load the served real content and ready it for the sim in one call: fetch + validate via
 * {@link loadRealContent}, then {@link mergeRealContent} (gathering balance + nav-terrain classes +
 * localized `goodNames`). Returns `null` on a bare checkout (no `content/ir.json`) so the interactive
 * entries fall back to the clean-room sandbox content. The pure sim never does I/O — this is the app
 * boundary that mints the sim-ready set (`packages/app/AGENTS.md`).
 */
export async function loadRuntimeRealContent(
  goodNames?: ReadonlyMap<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<RealContentMerge | null> {
  const real = await loadRealContent(fetchImpl);
  return real === null ? null : mergeRealContent(real, goodNames);
}

/**
 * Log the gaps {@link mergeRealContent} surfaced — gathered goods with no clean-room balance and
 * buildings beyond the clean-room catalog — as one console line, so a browser run shows what the overlay
 * could not fill. No-op when there is nothing to report.
 */
export function logRealContentGaps(merge: RealContentMerge): void {
  const { unbalancedGoods, uncatalogedBuildings } = merge;
  if (unbalancedGoods.length === 0 && uncatalogedBuildings.length === 0) return;
  console.info(
    `real content gaps: ${unbalancedGoods.length} gathered good(s) without clean-room balance ` +
      `[${unbalancedGoods.join(', ')}], ${uncatalogedBuildings.length} building(s) beyond the catalog ` +
      `[${uncatalogedBuildings.join(', ')}]`,
  );
}
