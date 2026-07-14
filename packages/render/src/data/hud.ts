import type { WorldSnapshot } from '@open-northland/sim';
import { readStockpileAmounts } from './stockpile.js';

/**
 * The pure HUD-model layer: turns a {@link WorldSnapshot} into a flat {@link HudModel} the GPU/DOM
 * layer lays out as text + bars.
 *
 * It re-derives the aggregates of the sim's own read views (`tribeStocks`/`tribePopulation`/
 * `tribePopulationByJob`) from the frozen snapshot rather than calling them, because `render` must
 * never read the live component stores (docs/ARCHITECTURE.md). The snapshot is taken at a tick
 * boundary, and counts/sums are order-independent, so the values match the sim views by construction.
 */

/**
 * The HUD job-key for an idle, job-seeking adult (`Settler.jobType === null`). `-1` sits outside the
 * `0..` `JobType.typeId` space (`0` is the valid `none` id), so it can never collide with a real
 * job's count — the same sentinel the sim's `tribePopulationByJob` view uses.
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
 * these arrays in paint order.
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
 * missing or malformed `tribe` field reads as "not a countable settler".
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
 * Build a tribe's {@link HudModel} from a frame {@link WorldSnapshot}, mirroring the sim read views
 * `tribePopulation`, `tribePopulationByJob`, and `tribeStocks`:
 *  - population = count of the tribe's `Settler`s (every settler is a mouth, idle or not).
 *  - jobs = per-`jobType` head-count; an idle adult (`jobType === null`) is keyed by {@link IDLE_JOB}.
 *  - stocks = per-`goodType` total across the tribe's stores (any `Building` with a `Stockpile`),
 *    summed from each store's snapshot `amounts`; a good summing to `0` everywhere is omitted.
 *
 * Output ordering is explicit and total (sorted by id), so the same snapshot yields a byte-identical
 * model every call.
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

/** One positioned text row of the laid-out HUD panel — a string anchored at a panel-relative `(x, y)`. */
export interface HudTextRow {
  /** Panel-relative x of the row's left edge, in pixels. */
  readonly x: number;
  /** Panel-relative y of the row's text baseline-top, in pixels. */
  readonly y: number;
  /** The display string for this row (a heading or a tally line). */
  readonly text: string;
}

/**
 * A laid-out HUD panel: its pixel box (`width`×`height`, sized to the content) plus the flat,
 * top-to-bottom ordered list of {@link HudTextRow}s the GPU/DOM layer paints.
 */
export interface HudLayout {
  /** Panel width in pixels (a fixed column — the rows are short tally lines). */
  readonly width: number;
  /** Panel height in pixels: the padding + every row's line height (grows with the row count). */
  readonly height: number;
  /** The text rows, in paint order (top to bottom): headings then their tallies. */
  readonly rows: readonly HudTextRow[];
}

/** User-facing text formatters supplied by the app locale layer. */
export interface HudLabels {
  readonly tribeTick: (tribe: number, tick: number) => string;
  readonly population: (population: number) => string;
  readonly jobs: string;
  readonly stocks: string;
  readonly idle: string;
  readonly job: (jobType: number) => string;
  readonly good: (goodType: number) => string;
}

/** Layout constants for {@link layoutHud} — a single fixed column of stacked text rows. */
const HUD_PAD = 8; // px inset from the panel edge to the first row / the left margin
const HUD_LINE_H = 16; // px vertical advance between successive rows
const HUD_WIDTH = 200; // px panel width (a narrow side column)
const HUD_INDENT = 12; // px extra left-indent for a tally row under its heading

/**
 * Lay out a {@link HudModel} into a {@link HudLayout} of panel-relative pixel positions.
 *
 * It stacks the model into labelled sections — a header (tribe + tick, population), then a jobs
 * section, then a stocks section — with rows advancing by {@link HUD_LINE_H} top to bottom and
 * tallies indented under their heading. The panel `height` is sized to exactly fit the rows.
 *
 * A function of the model alone: no Pixi and no measured glyph metrics (the width is a fixed column
 * and the height counts rows), so the same model lays out byte-identically every call.
 */
export function layoutHud(model: HudModel, labels: HudLabels): HudLayout {
  const rows: HudTextRow[] = [];
  let y = HUD_PAD;
  const push = (text: string, indent = false): void => {
    rows.push({ x: HUD_PAD + (indent ? HUD_INDENT : 0), y, text });
    y += HUD_LINE_H;
  };

  push(labels.tribeTick(model.tribe, model.tick));
  push(labels.population(model.population));

  push(labels.jobs);
  for (const { jobType, count } of model.jobs) {
    const label = jobType === IDLE_JOB ? labels.idle : labels.job(jobType);
    push(`${label}: ${count}`, true);
  }

  push(labels.stocks);
  for (const { goodType, amount } of model.stocks) {
    push(`${labels.good(goodType)}: ${amount}`, true);
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
 * pixels plus every row's text re-anchored to absolute screen coordinates. The Pixi draw
 * (`renderHud`) consumes this and creates one display object per element.
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
 * Place a laid-out {@link HudLayout} at a screen {@link HudCorner}, converting panel-relative layout
 * to absolute canvas pixels. It (1) picks the panel's top-left from the corner plus a
 * {@link HUD_MARGIN} edge inset, (2) clamps it so the whole panel stays on-screen even if the canvas
 * is smaller than the panel, and (3) re-anchors every row's panel-relative `(x, y)` to that origin.
 *
 * A function of layout + corner + screen size alone (no Pixi, no glyph metrics), so the same inputs
 * place byte-identically every call.
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
