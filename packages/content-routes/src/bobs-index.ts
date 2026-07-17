import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Node-side builder for the `/bobs-index` payload — the list the in-app icon gallery (`?icons`)
 * browses. It lists the viewable bob atlases: palette-applied RGBA sheets (`<stem>.png` +
 * `<stem>.atlas.json`) the pipeline emits for the GUI, goods, and every landscape/house/object set.
 * The `.indexed.*` atlases carry a palette index in the red channel for the runtime recolour instead
 * of a viewable image, so they are skipped. Each entry splits into a `base` set + palette `variant`
 * so the gallery can group the 300-plus sheets (`ls_trees.tree_cypress01` → `ls_trees` +
 * `tree_cypress01`).
 */

/** One `/bobs-index` entry: a viewable atlas stem and its base-set / palette-variant split. */
export interface BobsIndexEntry {
  /** The atlas stem — the `/bobs/<stem>.png` + `/bobs/<stem>.atlas.json` the gallery loads. */
  readonly stem: string;
  /** The base sprite set (the stem up to the first dot), e.g. `ls_gui_window`, `ls_houses_viking`. */
  readonly base: string;
  /** The palette variant (the stem after the first dot), e.g. `iconsleft`, `house01`; `''` if none. */
  readonly variant: string;
}

/**
 * Build one entry per viewable RGBA atlas under `bobsRoot`, sorted by (base, variant): both
 * `<stem>.png` and `<stem>.atlas.json` present, and the stem not ending in `.indexed`. `bobsRoot`
 * must exist — the caller guards.
 */
export function buildBobsIndexEntries(bobsRoot: string): BobsIndexEntry[] {
  const stems = readdirSync(bobsRoot)
    .filter((f) => f.endsWith('.atlas.json'))
    .map((f) => f.slice(0, -'.atlas.json'.length))
    .filter((stem) => !stem.endsWith('.indexed') && existsSync(join(bobsRoot, `${stem}.png`)));

  return stems
    .map((stem) => {
      const dot = stem.indexOf('.');
      const base = dot === -1 ? stem : stem.slice(0, dot);
      const variant = dot === -1 ? '' : stem.slice(dot + 1);
      return { stem, base, variant };
    })
    .sort((a, b) => a.base.localeCompare(b.base) || a.variant.localeCompare(b.variant));
}
