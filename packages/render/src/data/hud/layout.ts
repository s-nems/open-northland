import { type HudModel, IDLE_JOB } from './model.js';

/**
 * The HUD panel's text layout: a {@link HudModel} stacked into panel-relative pixel rows. No Pixi and
 * no measured glyph metrics — a pure function of the model, so it is unit-tested headlessly. Anchoring
 * the laid-out panel to a screen corner is {@link import('./place.js')}'s.
 */

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
