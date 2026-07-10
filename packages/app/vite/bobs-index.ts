import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Node-side builder for the dev server's `/bobs-index` payload (`vite.config.ts` `serveBobsIndex`) — the
 * list the in-app icon gallery (`?icons`, `entries/icons.ts`) browses. Dev-server code, kept beside the
 * vite config it serves but in its own module so the scan is unit-testable against a fixture directory.
 *
 * It lists every VIEWABLE bob atlas: a palette-applied RGBA sheet (`<stem>.png` + `<stem>.atlas.json`)
 * the pipeline already emits for the GUI, goods, and every landscape/house/object set. The `.indexed.*`
 * atlases are skipped — those carry the palette index in the red channel (for the runtime recolour), not
 * a human-viewable image. Each entry is split into a `base` set + `variant` (the palette) so the gallery
 * can group the 300-plus sheets (e.g. `ls_trees.tree_cypress01` → base `ls_trees`, variant `tree_cypress01`).
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
 * Build one entry per viewable RGBA atlas under `bobsRoot`, sorted by (base, variant). An atlas is
 * viewable when it has both `<stem>.png` and `<stem>.atlas.json` and the stem does NOT end in `.indexed`.
 * `bobsRoot` must exist (the caller guards); a missing `content/` yields the middleware falling through.
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
