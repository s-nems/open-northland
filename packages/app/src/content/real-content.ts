import { type ContentSet, parseContentSet } from '@open-northland/data';
import { VIKING_BUILDINGS } from '../catalog/buildings.js';
import { GATHERING_BALANCE_BY_ID } from '../catalog/gathering.js';
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
  /** The real content with the clean-room felling/mining balance pinned into its zeroed gathering blocks. */
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
 */
export function mergeRealContent(real: ContentSet): RealContentMerge {
  const goods = real.goods.map((good) => {
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
  return { content: parseContentSet({ ...real, goods }), unbalancedGoods, uncatalogedBuildings };
}
