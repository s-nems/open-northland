/**
 * The settlement backdrop shared by the main menu and the boot card. Bound through `import.meta.url`
 * rather than `public/` so Vite fingerprints it.
 *
 * A screenshot of Open Northland's own renderer, never the original game's (docs/LEGAL.md).
 */

export const BRAND_BACKDROP = new URL('../../../../docs/images/settlement.webp', import.meta.url).href;

/** The stacked logo lockup (emblem, ribbon and wordmark) that heads the main menu. */
export const BRAND_LOGO_STACKED = new URL('../assets/brand/logo-stacked.webp', import.meta.url).href;

/** The canvas `npm run brand` renders the stacked lockup into, so the menu can reserve its box. */
export const BRAND_LOGO_STACKED_SIZE = { width: 900, height: 840 } as const;
