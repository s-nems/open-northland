import type { WorldSnapshot } from '@open-northland/sim';
import { readStockpileAmounts } from './stockpile.js';

/**
 * The PURE HUD-model layer — the part of the on-screen HUD an agent CAN self-verify, exactly
 * analogous to {@link buildScene} for the world view (see scene.ts).
 *
 * It turns a {@link WorldSnapshot} into a flat, structured {@link HudModel} (a tribe's population
 * summary, per-job head-counts, and per-good stock totals) — plain data the GPU/DOM layer (the
 * un-self-verifiable pixel half, deferred to a human) lays out as text + bars. Keeping the
 * *aggregation* here means the load-bearing HUD logic — *which* number a panel shows — is
 * unit-testable without a screen (see test/hud.test.ts), and the human only judges the typography.
 *
 * Why off the SNAPSHOT, not the sim read views: `render` is a pure consumer of sim state and must
 * never read the live component stores (docs/ARCHITECTURE.md; the determinism contract). The sim's
 * own internal read views (`tribeStocks`/`tribePopulation`/`tribePopulationByJob`) take a live
 * `World`; the HUD instead re-derives the *same* aggregates from the frozen, plain-cloned snapshot
 * the renderer already holds — the snapshot is taken at a tick boundary, so the HUD can't observe a
 * half-applied mutation. The values match the sim views by construction (a count / a sum is
 * order-independent), but this path never re-enters the sim.
 */

/**
 * The HUD job-key for an **idle, job-seeking adult** (`Settler.jobType === null`). `-1`, outside the
 * `0..` `JobType.typeId` space (real ids start at 1; `0` is the valid `none` id), so it can never
 * collide with a real job's count — the same sentinel the sim's `tribePopulationByJob` view uses.
 */
export const IDLE_JOB = -1;

/** A single per-job tally row of the HUD: a `jobType` id (or {@link IDLE_JOB}) and its head-count. */
export interface JobCount {
  /** A real `JobType.typeId`, or {@link IDLE_JOB} (`-1`) for an unassigned adult. Keys 1–4 are the
   * non-working baby/child age classes (the `jobType`-as-life-stage model); the consumer partitions. */
  readonly jobType: number;
  readonly count: number;
}

/** A single per-good stock row of the HUD: a `goodType` id and the tribe-wide total held. */
export interface StockCount {
  readonly goodType: number;
  readonly amount: number;
}

/**
 * The display model for one tribe's HUD at a tick — flat, sorted, plain data. The pixel layer reads
 * these arrays in order; everything is already deterministically ordered so the panel never reshuffles
 * between equal frames.
 */
export interface HudModel {
  /** The tick this model was built for (the snapshot's tick) — a HUD can show "tick N". */
  readonly tick: number;
  /** The tribe this model summarizes. */
  readonly tribe: number;
  /** Total living settlers of the tribe (every settler, idle or working, baby or adult — all mouths). */
  readonly population: number;
  /** Per-job head-counts, ascending by `jobType` (idle's `-1` sorts first) — a stable display order. */
  readonly jobs: readonly JobCount[];
  /** Per-good stock totals across the tribe's stores, ascending by `goodType`; zero entries omitted. */
  readonly stocks: readonly StockCount[];
}

/** The plain-cloned `Settler` component as it appears in a snapshot (a subset of the sim shape). */
interface SettlerValue {
  tribe?: unknown;
  jobType?: unknown;
}

/** The plain-cloned `Building` component as it appears in a snapshot. */
interface BuildingValue {
  tribe?: unknown;
}

/**
 * Read an entity's `Settler` component (tribe + jobType), or `null` if it isn't a settler. Total: a
 * missing/malformed `tribe` field reads as "not a countable settler". (`buildingOf` is its twin for
 * the store side; `Settler` and `Building` are the two tribe-owning markers the HUD aggregates.)
 */
function settlerOf(components: Readonly<Record<string, unknown>>): SettlerValue | null {
  const s = components.Settler as SettlerValue | undefined;
  if (s === undefined || typeof s.tribe !== 'number') return null;
  return s;
}

function buildingOf(components: Readonly<Record<string, unknown>>): BuildingValue | null {
  const b = components.Building as BuildingValue | undefined;
  if (b === undefined || typeof b.tribe !== 'number') return null;
  return b;
}

/**
 * Build a tribe's {@link HudModel} from a frame {@link WorldSnapshot} — the pure data half of the HUD.
 *
 * Mirrors the three world-state sim read views (`tribePopulation`, `tribePopulationByJob`,
 * `tribeStocks`) but sourced from the plain snapshot so `render` never reads the live stores:
 *  - **population** = count of the tribe's `Settler`s (every settler is a mouth, idle or not).
 *  - **jobs** = per-`jobType` head-count; an idle adult (`jobType === null`) is keyed by
 *    {@link IDLE_JOB} (`-1`, outside the `0..` id space, so it can't collide with a real job — the
 *    same sentinel + the same `?? IDLE_JOB` nullish fold the sim view uses, never `||`, because `0`
 *    (`none`) is a valid job id).
 *  - **stocks** = per-`goodType` total across the tribe's stores (any `Building` with a `Stockpile`),
 *    summed from each store's snapshot `amounts`; a good summing to `0` everywhere is omitted.
 *
 * Output ordering is explicit + total (sorted by id), so the same snapshot yields a byte-identical
 * model every call — the determinism that keeps the HUD from reshuffling between equal frames, and
 * lets a screenshot harness produce a reproducible panel. Floats never appear (all counts/amounts are
 * integers); even so this is `render`, where floats would be allowed.
 */
export function buildHud(snapshot: WorldSnapshot, tribe: number): HudModel {
  let population = 0;
  const jobCounts = new Map<number, number>();
  const stockTotals = new Map<number, number>();

  for (const entity of snapshot.entities) {
    const settler = settlerOf(entity.components);
    if (settler !== null && settler.tribe === tribe) {
      population++;
      // `jobType` is `number | null`; fold null onto the idle sentinel with `??` (a job id of 0 is
      // valid, so `||` would mis-bucket it).
      const jobType = typeof settler.jobType === 'number' ? settler.jobType : IDLE_JOB;
      jobCounts.set(jobType, (jobCounts.get(jobType) ?? 0) + 1);
    }

    const building = buildingOf(entity.components);
    if (building !== null && building.tribe === tribe) {
      for (const [goodType, amount] of readStockpileAmounts(entity.components)) {
        stockTotals.set(goodType, (stockTotals.get(goodType) ?? 0) + amount);
      }
    }
  }

  // Explicit ascending-id sort so the display order is total + stable (the snapshot's Maps were
  // already key-sorted, but jobCounts/stockTotals are built here in entity-iteration order).
  const jobs: JobCount[] = [...jobCounts.entries()]
    .map(([jobType, count]) => ({ jobType, count }))
    .sort((a, b) => a.jobType - b.jobType);
  const stocks: StockCount[] = [...stockTotals.entries()]
    .filter(([, amount]) => amount !== 0) // drop a good that nets to zero across all stores
    .map(([goodType, amount]) => ({ goodType, amount }))
    .sort((a, b) => a.goodType - b.goodType);

  return { tick: snapshot.tick, tribe, population, jobs, stocks };
}

/**
 * One positioned text row of the laid-out HUD panel — a string anchored at a panel-relative `(x, y)`.
 * The pixel layer (the un-self-verifiable half) draws `text` at this position; the *layout* (which
 * string lands where) is computed here so it is unit-testable without a screen, exactly as
 * {@link DrawItem} positions are for the world scene.
 */
export interface HudTextRow {
  /** Panel-relative x of the row's left edge, in pixels. */
  readonly x: number;
  /** Panel-relative y of the row's text baseline-top, in pixels. */
  readonly y: number;
  /** The display string for this row (a heading or a tally line). */
  readonly text: string;
}

/**
 * A laid-out HUD panel: its pixel box (`width`×`height` — sized to the content) plus the flat,
 * top-to-bottom ordered list of {@link HudTextRow}s the GPU/DOM layer paints. Everything is derived
 * deterministically from a {@link HudModel}, so the same model lays out byte-identically — the panel
 * never reshuffles between equal frames (the same property {@link buildScene}'s draw list has).
 */
export interface HudLayout {
  /** Panel width in pixels (a fixed column — the rows are short tally lines). */
  readonly width: number;
  /** Panel height in pixels: the padding + every row's line height (grows with the row count). */
  readonly height: number;
  /** The text rows, in paint order (top to bottom): headings then their tallies. */
  readonly rows: readonly HudTextRow[];
}

/** Layout constants for {@link layoutHud} — a single fixed column of stacked text rows. */
const HUD_PAD = 8; // px inset from the panel edge to the first row / the left margin
const HUD_LINE_H = 16; // px vertical advance between successive rows
const HUD_WIDTH = 200; // px panel width (a narrow side column)
const HUD_INDENT = 12; // px extra left-indent for a tally row under its heading

/**
 * Lay out a {@link HudModel} into a {@link HudLayout} — the pure, self-verifiable bridge between the
 * HUD *data* ({@link buildHud}) and its *pixels*, exactly analogous to how {@link buildScene} turns a
 * snapshot into positioned {@link DrawItem}s before the GPU draws them.
 *
 * It stacks the model into labelled sections — a header (`Tribe N · tick T`, `Population: P`), then a
 * **Jobs** section (one indented `job <id>: <count>` per tally, the idle sentinel rendered as
 * `idle`), then a **Stocks** section (one indented `good <id>: <amount>` per tally) — assigning each a
 * panel-relative `(x, y)`: rows advance by {@link HUD_LINE_H} top to bottom, tallies indented under
 * their heading. The panel `height` is sized to exactly fit the rows (padding + count·lineHeight), so
 * an empty tribe yields a short box and a busy one a tall one.
 *
 * Pure + total: a function of the model alone (no Pixi, no measured glyph metrics — the width is a
 * fixed column and the height counts rows), so the same model lays out byte-identically every call.
 * The human only judges the resulting typography; *which line lands where* is pinned here and tested.
 */
export function layoutHud(model: HudModel): HudLayout {
  const rows: HudTextRow[] = [];
  let y = HUD_PAD;
  const push = (text: string, indent = false): void => {
    rows.push({ x: HUD_PAD + (indent ? HUD_INDENT : 0), y, text });
    y += HUD_LINE_H;
  };

  push(`Tribe ${model.tribe} · tick ${model.tick}`); // "·" middot separator
  push(`Population: ${model.population}`);

  push('Jobs');
  for (const { jobType, count } of model.jobs) {
    const label = jobType === IDLE_JOB ? 'idle' : `job ${jobType}`;
    push(`${label}: ${count}`, true);
  }

  push('Stocks');
  for (const { goodType, amount } of model.stocks) {
    push(`good ${goodType}: ${amount}`, true);
  }

  // After the loop `y == HUD_PAD + rows.length·HUD_LINE_H` (top pad + every row already counted);
  // add one bottom pad symmetric with the top inset so the box hugs the content.
  return { width: HUD_WIDTH, height: y + HUD_PAD, rows };
}

/** Which screen corner {@link placeHud} anchors the panel to (then insets by {@link HUD_MARGIN}). */
export type HudCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** px gap kept between the panel and the canvas edge it anchors to. */
const HUD_MARGIN = 8;

/** The canvas the panel is placed on — only its pixel size matters for corner anchoring + clamping. */
export interface HudScreen {
  readonly width: number;
  readonly height: number;
}

/**
 * A {@link HudLayout} placed at an absolute screen position — the panel's top-left corner in canvas
 * pixels plus every row's text re-anchored to absolute screen coordinates. This is the last
 * self-verifiable decision before the GPU: *where on the canvas* each panel row lands. The Pixi draw
 * (`renderHud`) consumes this and creates one display object per element, so the only thing left
 * un-self-verifiable is the glyph rasterization a human eyeballs.
 */
export interface HudPlacement {
  /** Panel top-left x in canvas pixels (after corner-anchoring + on-screen clamp). */
  readonly panelX: number;
  /** Panel top-left y in canvas pixels. */
  readonly panelY: number;
  /** Panel width in pixels (carried through from the layout — a fixed column). */
  readonly width: number;
  /** Panel height in pixels (carried through from the layout — grows with the row count). */
  readonly height: number;
  /** The text rows with absolute screen `(x, y)` (panel origin + the layout's panel-relative offset). */
  readonly rows: readonly HudTextRow[];
}

/**
 * Place a laid-out {@link HudLayout} at a screen {@link HudCorner} — the pure bridge from panel-relative
 * layout to absolute canvas pixels, the screen-space analogue of how `terrainMapToScene` projects tiles
 * into the scene before the GPU draws them. It (1) picks the panel's top-left from the corner + a
 * {@link HUD_MARGIN} edge inset, (2) **clamps** it so the whole panel stays on-screen even if the canvas
 * is smaller than the panel (so a tall HUD never slides off the top), and (3) re-anchors every row's
 * panel-relative `(x, y)` to that origin.
 *
 * Pure + total (a function of layout + corner + screen size alone — no Pixi, no glyph metrics), so the
 * same inputs place byte-identically every call; *which screen pixel each row lands on* is unit-tested
 * (see test/hud.test.ts), leaving only the typography to a human.
 */
export function placeHud(layout: HudLayout, corner: HudCorner, screen: HudScreen): HudPlacement {
  const right = corner === 'top-right' || corner === 'bottom-right';
  const bottom = corner === 'bottom-left' || corner === 'bottom-right';

  // Anchor to the chosen corner, inset by the margin; then clamp into [0, screen − panel] so the whole
  // panel stays visible. `Math.max(0, …)` wins the clamp when the panel is taller/wider than the canvas
  // (the top/left edge is kept on-screen rather than the bottom/right) — a deterministic tie-break.
  const rawX = right ? screen.width - layout.width - HUD_MARGIN : HUD_MARGIN;
  const rawY = bottom ? screen.height - layout.height - HUD_MARGIN : HUD_MARGIN;
  const panelX = Math.max(0, Math.min(rawX, screen.width - layout.width));
  const panelY = Math.max(0, Math.min(rawY, screen.height - layout.height));

  const rows: HudTextRow[] = layout.rows.map((r) => ({ x: panelX + r.x, y: panelY + r.y, text: r.text }));
  return { panelX, panelY, width: layout.width, height: layout.height, rows };
}
