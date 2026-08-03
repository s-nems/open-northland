/**
 * `housewindow` string ids from the original `ingamegui` tables, decoded into
 * `content/gui/strings/<lang>.json`; the glosses are the pinned fallbacks for a checkout without content.
 */
export const HOUSEWINDOW = {
  general: 1, // 'Ogólny'
  defence: 2, // 'Obrona'
  stock: 5, // 'Magazyn'
  workers: 7, // 'Pracownicy'
  residents: 8, // 'Mieszkańcy'
  families: 52, // 'Liczba Rodzin'
  upgrade: 110, // 'Ulepszenie'
  cancelUpgrade: 112, // 'Anuluj Ulepszanie'
  demolish: 114, // 'Zniszcz'
  center: 116, // 'Wycentruj'
  workersButton: 118, // 'Pracownicy'
  help: 120, // 'Pomoc'
} as const;

/** Stock cell: icon slot width before the amount plate (≈15 px icon + a small gap in the original). */
export const STOCK_ICON_W = 18;
/** Left inset of the amount text inside its plate (observed off the original's 1024×768 screenshots). */
export const STOCK_AMOUNT_INSET = 6;

/**
 * One decimal, left-aligned in the plate, with the extracted `logicstock` capacity appended when the row
 * declares a slot (observed off the original's 1024×768 screenshots).
 */
export function stockAmount(amount: number, capacity?: number): string {
  return capacity === undefined ? amount.toFixed(1) : `${amount.toFixed(1)} / ${capacity.toFixed(1)}`;
}
