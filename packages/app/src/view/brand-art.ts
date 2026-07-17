/**
 * The settlement backdrop, shared by the main menu ({@link import('../entries/menu.js')}) and the boot card
 * ({@link import('./boot-progress.js')}) so leaving the menu does not change the art the player is looking
 * at. Bound through `import.meta.url` rather than `public/`, so Vite fingerprints it.
 *
 * A screenshot of OpenNorthland's own renderer (the README hero), never the original game's — docs/LEGAL.md.
 */

export const BRAND_BACKDROP = new URL('../../../../docs/images/settlement.webp', import.meta.url).href;
