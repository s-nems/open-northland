/**
 * The details-panel section drawing, split by the thing each selection draws: the building window
 * sections (`building.ts` — Ogólny/Obrona/Produkcja/Magazyn/Pracownicy + the stock tabs), the settler
 * window sections (`settler.ts` — Ogólne/Praca/Doświadczenie/Ekwipunek), and the compact
 * multi-selection strip (`compact.ts`). All draw over the shared {@link import('../chrome.js').Chrome}
 * kit; `shared.ts` holds the one row-text metric they share.
 */

export { drawBuilding } from './building/index.js';
export { drawCompact } from './compact.js';
export { drawSettler } from './settler.js';
