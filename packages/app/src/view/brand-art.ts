/**
 * The settlement backdrop shared by the main menu and the boot card. Bound through `import.meta.url`
 * rather than `public/` so Vite fingerprints it.
 *
 * A screenshot of Open Northland's own renderer, never the original game's (docs/LEGAL.md).
 */

export const BRAND_BACKDROP = new URL('../../../../docs/images/settlement.webp', import.meta.url).href;

/** The stacked lockup (emblem, ribbon and wordmark) in the muted tone the main menu uses. */
export const BRAND_LOGO_STACKED_MUTED = new URL('../assets/brand/logo-stacked-muted.webp', import.meta.url)
  .href;
