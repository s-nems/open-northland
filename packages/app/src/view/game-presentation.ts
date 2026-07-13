import type { WorldRenderer } from '@open-northland/render';
import { BUILD_HOUSE_ATOMIC, HARVEST_ATOMIC } from '../catalog/atomics.js';
import { createSoundDriver } from '../content/audio.js';
import { loadIr } from '../content/ir.js';
import { loadCombatBones } from '../content/objects.js';
import { mountSoundToggle } from './overlay.js';

/** Load optional decoded presentation assets shared by the game view's sound and combat rendering. */
export async function mountGamePresentation(
  params: URLSearchParams,
  renderer: WorldRenderer,
): Promise<ReturnType<typeof createSoundDriver> | null> {
  const ir = await loadIr();
  const sound =
    params.get('sound') === 'off'
      ? null
      : createSoundDriver(ir, {
          chopAtomicId: HARVEST_ATOMIC,
          buildAtomicId: BUILD_HOUSE_ATOMIC,
        });
  if (sound !== null) {
    sound.setEnabled(false);
    mountSoundToggle(sound);
  }
  renderer.setCombatBonesGfx(ir !== null ? await loadCombatBones(ir) : null);
  return sound;
}
