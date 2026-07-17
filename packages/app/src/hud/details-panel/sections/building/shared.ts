/**
 * The decoded `housewindow` string ids the building sections consume (see `content/gui/strings/<lang>.json`,
 * decoded from the original `ingamegui` tables) — titles and button labels come from the original, with
 * pinned Polish fallbacks for a checkout without `content/`.
 */
export const HOUSEWINDOW = {
  general: 1, // 'Ogólny'
  defence: 2, // 'Obrona'
  stock: 5, // 'Magazyn'
  workers: 7, // 'Pracownicy'
  residents: 8, // 'Mieszkańcy'
  families: 52, // 'Liczba Rodzin'
  upgrade: 110, // 'Ulepszenie'
  demolish: 114, // 'Zniszcz'
  center: 116, // 'Wycentruj'
  workersButton: 118, // 'Pracownicy'
  help: 120, // 'Pomoc'
} as const;

/** Stock cell: icon slot width before the amount plate (≈15 px icon + a small gap in the original). */
export const STOCK_ICON_W = 18;
/** Left inset of the amount text inside its plate (eyeballed off the 1024×768 screenshots). */
export const STOCK_AMOUNT_INSET = 6;

/**
 * Stock amounts render with one decimal, left-aligned inside the plate ("15.0") — both observed off
 * the original's 1024×768 screenshots. A row with a declared slot also shows its ceiling
 * ("7.0 / 25.0" — the capacity is the building's extracted `logicstock` slot), so a filling store reads
 * at a glance; a dynamic drop (no declared slot) keeps the bare amount.
 */
export function stockAmount(amount: number, capacity?: number): string {
  return capacity === undefined ? amount.toFixed(1) : `${amount.toFixed(1)} / ${capacity.toFixed(1)}`;
}
