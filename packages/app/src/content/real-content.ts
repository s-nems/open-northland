import { type ContentSet, type GoodType, hasFieldFarmAtomics, parseContentSet } from '@open-northland/data';
import { VIKING_BUILDINGS } from '../catalog/buildings.js';
import { FARMING_BALANCE_BY_ID } from '../catalog/farming.js';
import { GATHERING_BALANCE_BY_ID } from '../catalog/gathering.js';
import { NAV_LANDSCAPE_TYPES } from '../catalog/terrain.js';
import { HUMAN_HITPOINTS } from '../catalog/units.js';
import { diag } from '../diag/index.js';
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

/** The real content with its clean-room balance completed, plus the gaps the overlay cannot fill. */
export interface RealContentMerge {
  /** The real content readied for the sim: localized good names, the clean-room felling/mining balance
   *  pinned into its zeroed gathering blocks, the clean-room field-farming block added to farmed goods,
   *  the clean-room settler HP set on the playable tribes, and the sim's nav-terrain classes
   *  ({@link NAV_LANDSCAPE_TYPES}) added to `landscape`. */
  readonly content: ContentSet;
  /** Gathered goods (they carry a `gathering` block) with no clean-room balance — they stay uncalibrated
   *  (leather/honey/meat are animal/production goods the sandbox never map-gathers). */
  readonly unbalancedGoods: readonly string[];
  /** Field-farmed goods (they carry the three field atomics) with no clean-room `farming` block yet — the
   *  pipeline correctly gives them no recipe (grown, not made), so until a block lands they neither
   *  field-farm nor produce. Wheat is calibrated; herb/mushroom are the known gap (see the tracker). */
  readonly unfarmedFieldGoods: readonly string[];
  /** Real buildings absent from the clean-room catalog (`VIKING_BUILDINGS`) — the wonders/vehicles/special
   *  the sandbox never modelled. They keep their extracted footprint/stock/recipe but no clean-room tuning. */
  readonly uncatalogedBuildings: readonly string[];
}

/** Localize a good's display name from the app-wide `?lang=` map, keyed by its string id — the real IR
 *  ships raw ids where the sandbox carried English `name`s. A good the map lacks keeps its own name. */
function withLocalizedName(good: GoodType, goodNames?: ReadonlyMap<string, string>): GoodType {
  const name = goodNames?.get(good.id);
  return name !== undefined ? { ...good, name } : good;
}

/** Overlay the clean-room field-farming block (growth timing, field radius/count) the pipeline cannot
 *  extract — no readable growth constants — keyed by good id from the shared {@link FARMING_BALANCE_BY_ID}
 *  the sandbox also reads, so wheat farms at one pace on either content base. The pipeline extracts the
 *  field atomics + `producedOnMap` flag and (correctly) gives the farm no recipe; this block is the last
 *  piece the sim's field loop needs. A good absent from the table is returned unchanged. */
function withFarmingBalance(good: GoodType): GoodType {
  const farming = FARMING_BALANCE_BY_ID[good.id];
  return farming !== undefined ? { ...good, farming } : good;
}

/** Overlay the clean-room felling/mining balance (chops-to-fell / yield / deposit size+levels) into the
 *  pipeline's zeroed gathering block, keyed by good id from the shared {@link GATHERING_BALANCE_BY_ID}
 *  (the mod data carries no chop count — `catalog/felling.ts`), preserving everything else real ships
 *  (harvest/pickup/store atomics, `bioLandscape`). A good with no gathering block, or none in the table,
 *  is returned unchanged. */
function withGatheringBalance(good: GoodType): GoodType {
  if (good.gathering === undefined) return good;
  const balance = GATHERING_BALANCE_BY_ID[good.id];
  if (balance === undefined) return good;
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
}

/**
 * Ready the real content for the sim by completing the clean-room balance the pipeline cannot extract,
 * then surface what it still cannot fill. Each good passes through three named overlays, all keyed by the
 * good's string id: {@link withLocalizedName}, {@link withFarmingBalance} (the field-cultivation timing),
 * and {@link withGatheringBalance} (the felling/mining tuning). The farming and gathering tables are the
 * same ones the sandbox reads, so a mechanic runs at one pace on either content base.
 *
 * Today's felling still runs through the sandbox `GATHERERS` placement path (`game/sandbox/place.ts`,
 * re-keyed to real ids) reading the same balance table, proven by `test/map-gatherer-cycle.test.ts`;
 * completing the ContentSet keeps it self-consistent and ready for a content-driven resource-spawn system.
 * Gathered goods with no clean-room balance, field goods with no clean-room `farming` block, and buildings
 * beyond the clean-room catalog are reported — not silently dropped — so the caller can log the gap.
 *
 * It also injects the sim's semantic nav-terrain classes ({@link NAV_LANDSCAPE_TYPES}) into `landscape`:
 * real content's detailed types (1..87) don't carry the collision classes a resolved grid
 * (`content/collision.ts`) or a scene grid navigates on, and those class ids sit in a reserved band that
 * never aliases the detailed types, so `buildTerrainGraph` on real content resolves both. Idempotent — a
 * class row already present is not duplicated.
 */
export function mergeRealContent(
  real: ContentSet,
  goodNames?: ReadonlyMap<string, string>,
): RealContentMerge {
  const goods = real.goods.map((raw) =>
    withGatheringBalance(withFarmingBalance(withLocalizedName(raw, goodNames))),
  );
  // A gathered good (carries a `gathering` block) still lacking clean-room balance stays uncalibrated.
  const unbalancedGoods = goods
    .filter((g) => g.gathering !== undefined && GATHERING_BALANCE_BY_ID[g.id] === undefined)
    .map((g) => g.id);
  // A field-farmed good (three field atomics) the farming overlay does not yet cover — the pipeline gives
  // it no recipe, so without a `farming` block it neither field-farms nor produces (herb/mushroom today).
  const unfarmedFieldGoods = goods
    .filter((g) => hasFieldFarmAtomics(g) && g.farming === undefined)
    .map((g) => g.id);
  const cataloged = new Set(VIKING_BUILDINGS.map((b) => b.id));
  const uncatalogedBuildings = real.buildings.filter((b) => !cataloged.has(b.id)).map((b) => b.id);
  const landscapeIds = new Set(real.landscape.map((t) => t.typeId));
  const navRows = NAV_LANDSCAPE_TYPES.filter((t) => !landscapeIds.has(t.typeId));
  const landscape = [...real.landscape, ...navRows];
  // Overlay the clean-room settler HP onto each playable tribe that ships without one (the real IR carries
  // no human hitpoints — unreadable, source basis "Combat hit resolution"), the same value the sandbox
  // tribes use, so a settler has one HP on either content base (`settlerHitpoints` reads it at every spawn).
  // Scoped to the player civs (a `jobEnables` tech-graph): an animal/monster tribe is no settler's tribe, so
  // it stays at its own (0) HP rather than carrying a stray human pool it never uses.
  const tribes = real.tribes.map((t) =>
    t.hitpoints > 0 || t.jobEnables.length === 0 ? t : { ...t, hitpoints: HUMAN_HITPOINTS },
  );
  // Re-validate the transformed set so a bad overlay or injected row fails here at the app boundary,
  // not deep in the sim.
  return {
    content: parseContentSet({ ...real, goods, landscape, tribes }),
    unbalancedGoods,
    unfarmedFieldGoods,
    uncatalogedBuildings,
  };
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
 * Log the gaps {@link mergeRealContent} surfaced — gathered goods with no clean-room balance, field goods
 * with no clean-room `farming` block, and buildings beyond the clean-room catalog — as one log line,
 * so a browser run shows what the overlay could not fill. No-op when there is nothing to report.
 */
export function logRealContentGaps(merge: RealContentMerge): void {
  const { unbalancedGoods, unfarmedFieldGoods, uncatalogedBuildings } = merge;
  if (unbalancedGoods.length === 0 && unfarmedFieldGoods.length === 0 && uncatalogedBuildings.length === 0)
    return;
  diag.info(
    'content',
    `real content gaps: ${unbalancedGoods.length} gathered good(s) without clean-room balance ` +
      `[${unbalancedGoods.join(', ')}], ${unfarmedFieldGoods.length} field good(s) without a farming block ` +
      `[${unfarmedFieldGoods.join(', ')}], ${uncatalogedBuildings.length} building(s) beyond the catalog ` +
      `[${uncatalogedBuildings.join(', ')}]`,
  );
}
