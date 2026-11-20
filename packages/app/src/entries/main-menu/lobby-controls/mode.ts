import type { MapSelectItem } from '../map-select/model.js';
import { switchRow } from './switch-row.js';

/** One on/off row per mode of `base`, at most one on; all off plays the base map. A row is named by the
 *  mode's name, with its detail as the tooltip. Empty for a map without modes. */
export function mapModeToggles(
  base: MapSelectItem,
  current: MapSelectItem | null,
  change: (mode: MapSelectItem | null) => void,
): HTMLElement[] {
  let chosen = current?.id ?? null;
  const rows = base.modes.map((mode) => {
    const toggle = switchRow(mode.mode?.name ?? mode.title, () => {
      chosen = chosen === mode.id ? null : mode.id;
      paint();
      change(chosen === null ? null : mode);
    });
    const detail = mode.mode?.detail;
    if (detail !== undefined) toggle.row.title = detail;
    return { id: mode.id, toggle };
  });
  function paint(): void {
    for (const { id, toggle } of rows) toggle.paint(chosen === id, false);
  }
  paint();
  return rows.map(({ toggle }) => toggle.row);
}
