import { type HudModel, IDLE_JOB } from './model.js';

/**
 * The HUD panel's text layout: a {@link HudModel} stacked into panel-relative pixel rows, with no
 * Pixi and no measured glyph metrics.
 */

export interface HudTextRow {
  /** Panel-relative x of the row's left edge, in pixels. */
  readonly x: number;
  /** Panel-relative y of the row's text baseline-top, in pixels. */
  readonly y: number;
  readonly text: string;
}

export interface HudLayout {
  /** Panel width in pixels - a fixed column. */
  readonly width: number;
  /** Panel height in pixels, sized to fit the rows. */
  readonly height: number;
  /** The text rows in paint order, top to bottom. */
  readonly rows: readonly HudTextRow[];
}

/** User-facing text formatters supplied by the app locale layer. */
export interface HudLabels {
  /** The header; `player` is null for nobody's model. */
  readonly playerTick: (player: number | null, tick: number) => string;
  readonly population: (population: number) => string;
  readonly jobs: string;
  readonly stocks: string;
  readonly idle: string;
  readonly job: (jobType: number) => string;
  readonly good: (goodType: number) => string;
}

const HUD_PAD = 8; // px inset from the panel edge to the first row / the left margin
const HUD_LINE_H = 16; // px vertical advance between successive rows
const HUD_WIDTH = 200; // px panel width (a narrow side column)
const HUD_INDENT = 12; // px extra left-indent for a tally row under its heading

/**
 * Stack a {@link HudModel} into panel-relative pixel rows: a header, then a jobs section, then a
 * stocks section, with tallies indented under their heading and the height sized to fit.
 */
export function layoutHud(model: HudModel, labels: HudLabels): HudLayout {
  const rows: HudTextRow[] = [];
  let y = HUD_PAD;
  const push = (text: string, indent = false): void => {
    rows.push({ x: HUD_PAD + (indent ? HUD_INDENT : 0), y, text });
    y += HUD_LINE_H;
  };

  push(labels.playerTick(model.player, model.tick));
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

  // `y` already counts every row, so one more pad closes the box symmetrically with the top inset.
  return { width: HUD_WIDTH, height: y + HUD_PAD, rows };
}
