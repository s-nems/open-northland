import { type MapVariantKind, mapVariantsOf } from '@open-northland/data';
import { mapVariantsSelectable } from '../../../game/map/variant.js';
import { switchRow } from './switch-row.js';

export interface MapVariantToggleText {
  readonly names: Readonly<Record<MapVariantKind, string>>;
  /** What each variant changes, as its row's tooltip. */
  readonly details: Readonly<Record<MapVariantKind, string>>;
  /** Also write each detail under its name, as the advanced window shows its rules. */
  readonly writeDetails?: boolean;
}

/** One on/off row per variant the map ships, at most one on; all off plays the map as authored. Empty
 *  for a map that ships none, and where variants are not selectable. */
export function mapVariantToggles(
  mapId: string,
  text: MapVariantToggleText,
  current: MapVariantKind | null,
  change: (variant: MapVariantKind | null) => void,
  selectable: boolean = mapVariantsSelectable(),
): HTMLElement[] {
  if (!selectable) return [];
  let chosen = current;
  const rows = mapVariantsOf(mapId).map(({ kind }) => {
    const toggle = switchRow(text.names[kind], () => {
      chosen = chosen === kind ? null : kind;
      paint();
      change(chosen);
    });
    toggle.row.title = text.details[kind];
    if (text.writeDetails === true) {
      const detail = document.createElement('small');
      detail.className = 'main-menu__rule-detail';
      detail.textContent = text.details[kind];
      toggle.label.append(detail);
    }
    return { kind, toggle };
  });
  function paint(): void {
    for (const { kind, toggle } of rows) toggle.paint(chosen === kind, false);
  }
  paint();
  return rows.map(({ toggle }) => toggle.row);
}
