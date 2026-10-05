export const SELECTION_STYLES = ['outline', 'pulse', 'ring-white', 'ring-green'] as const;
export type SelectionStyle = (typeof SELECTION_STYLES)[number];
export const DEFAULT_SELECTION_STYLE: SelectionStyle = 'ring-green';

export function parseSelectionStyle(value: unknown): SelectionStyle {
  return SELECTION_STYLES.find((style) => style === value) ?? DEFAULT_SELECTION_STYLE;
}

/** Artistic choice: a slow, shallow lift towards white; never darkens or hides the selected object. */
export function selectionLight(timeSeconds: number): number {
  return 0.16 + 0.06 * Math.sin((timeSeconds * Math.PI * 2) / 1.8);
}
