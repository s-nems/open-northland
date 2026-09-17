import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { UI_CUE_FILES } from '@open-northland/audio';
import { describe, expect, it } from 'vitest';
import { contentDir, hasRealIr, loadContentUnderTest } from './helpers.js';

/** The subtree the `/sounds/` route serves; the IR's `file` values are relative to it. */
const SOUNDS_DIR = 'sounds';

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

  it('carries the wavs the engine hardwires outside the bank: the clicks, the chat ring, the briefing and the quake', () => {
    for (const file of Object.values(UI_CUE_FILES)) {
      expect(existsSync(resolve(contentDir(), SOUNDS_DIR, file)), file).toBe(true);
    }
  });

  it('names creature voices and weapon impacts the bank resolves', async () => {
    const { real } = await loadContentUnderTest();
    const groups = new Set(real.sounds.staticGroups.map((g) => g.name.toLowerCase()));
    const ids = new Set(real.sounds.staticGroups.map((g) => g.logicSoundType));
    expect(real.sounds.humanVoices.length).toBeGreaterThan(0);
    expect(real.sounds.animalCalls.length).toBeGreaterThan(0);
    const voiceGroups = real.sounds.humanVoices.flatMap((v) => [
      ...(v.scream === undefined ? [] : [v.scream]),
      ...(v.generic === undefined ? [] : [v.generic]),
      ...v.respondOk,
      ...v.respondNo,
    ]);
    const calls = real.sounds.animalCalls.map((c) => c.group);
    expect([...voiceGroups, ...calls].filter((name) => !groups.has(name.toLowerCase()))).toEqual([]);
    const weaponIds = real.weapons.flatMap((w) => [
      ...Object.values(w.hitSounds),
      ...Object.values(w.missSounds),
    ]);
    expect(weaponIds.length).toBeGreaterThan(0);
    expect(weaponIds.filter((id) => !ids.has(id))).toEqual([]);
  });
});
