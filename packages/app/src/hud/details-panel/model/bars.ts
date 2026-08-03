import { ONE } from '@open-northland/sim';
import { healthOf, type SnapshotEntity } from '../../../game/snapshot.js';
import { messages } from '../../../i18n/index.js';

/** One stat bar in the Ogólne section. The level is satisfaction (full = content), not the sim's
 *  rising deficit. */
export interface PanelBar {
  readonly label: string;
  readonly pct: number;
  /** Tooltip value for the hovered row: raw points for health, a percent for a need. */
  readonly hover: string;
}

/**
 * Label approximation: the original names a building's equivalent row `housewindow` 20
 * "Zniszczenia"/"Damage", the complement of a bar that fills when healthy.
 */
export function healthBar(ent: SnapshotEntity): PanelBar | null {
  const health = healthOf(ent);
  // A capacity-less pool is no pool: an empty bar hovering "0/0" would read as destroyed.
  if (health === undefined || health.max <= 0) return null;
  return {
    label: messages().hud.health,
    pct: pctRatio(health.hitpoints, health.max),
    hover: `${health.hitpoints}/${health.max}`,
  };
}

export type BarTone = 'ok' | 'warn' | 'critical';
const BAR_WARN_BELOW_PCT = 50;
const BAR_CRITICAL_BELOW_PCT = 25;

/** Banding for the no-`content/` fallback only; the thresholds are an approximation, since with content
 *  the decoded `GuiBarRamp` colours the gauge instead. */
export function barTone(pct: number): BarTone {
  if (pct < BAR_CRITICAL_BELOW_PCT) return 'critical';
  if (pct < BAR_WARN_BELOW_PCT) return 'warn';
  return 'ok';
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function pct(fixed: number | undefined): number {
  return fixed === undefined ? 0 : clampPct((fixed / ONE) * 100);
}

export function pctRatio(elapsed: number | undefined, duration: number | undefined): number {
  if (elapsed === undefined || duration === undefined || duration <= 0) return 0;
  return clampPct((elapsed / duration) * 100);
}

/** Remaining-life percent of a wearing item, floored so that any wear at all reads at most 99. */
export function remainingPct(used: number | undefined): number {
  return Math.max(0, Math.min(100, Math.floor((1 - (used ?? 0) / ONE) * 100)));
}
