import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentDir, hasRealIr, loadContentUnderTest } from './helpers.js';

/** The subtree the `/sounds/` route serves; the IR's `file` values are relative to it. */
const SOUNDS_DIR = 'Data/engine2d/bin/sounds';

/**
 * Every wav the decoded sound bank names is a file the same run wrote, so a sound the game asks for
 * is never a 404. Skips without generated content (see `helpers.ts`).
 */
describe.runIf(hasRealIr())('decoded sound bank', () => {
  it('names only wavs the run copied into the served sounds tree', async () => {
    const { real } = await loadContentUnderTest();
    const groups = [...real.sounds.staticGroups, ...real.sounds.ambient, ...real.sounds.jingles];
    const files = new Set(groups.flatMap((group) => group.sfx.map((sfx) => sfx.file)));
    expect(files.size).toBeGreaterThan(0);
    const missing = [...files].filter((file) => !existsSync(resolve(contentDir(), SOUNDS_DIR, file)));
    expect(missing).toEqual([]);
  });
});
