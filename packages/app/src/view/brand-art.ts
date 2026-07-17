/**
 * The app's own branding art, shared by the main menu ({@link import('../entries/menu.js')}) and the boot
 * card ({@link import('./boot-progress.js')}) so menu → loading → game reads as one screen. Bound through
 * `import.meta.url` rather than `public/`, so Vite fingerprints them.
 *
 * OpenNorthland's own art (README hero + logo), never the original game's — see docs/LEGAL.md.
 */

export const BRAND_LOGO = new URL('../assets/logo.webp', import.meta.url).href;
export const BRAND_BACKDROP = new URL('../../../../docs/images/settlement.webp', import.meta.url).href;
