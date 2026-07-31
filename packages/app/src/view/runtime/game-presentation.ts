import type { WorldRenderer } from '@open-northland/render';
import { BUILD_HOUSE_ATOMIC, HARVEST_ATOMIC } from '../../catalog/atomics.js';
import { createSoundDriver } from '../../content/audio.js';
import { loadSettlerBubbleGfx } from '../../content/bubbles.js';
import { loadBuildingSignGfx } from '../../content/building-signs.js';
import { loadIr } from '../../content/ir/load.js';
import { loadCombatBones } from '../../content/objects.js';
import { mountSoundToggle } from '../overlay.js';

/** Load optional decoded presentation assets shared by the game view's sound and combat rendering.
 *  `hasSignArt` reports whether the `ls_temp` sign sheets resolved - the gate for door-badge click
 *  picking, whose hit geometry is the sign chain's. */
export async function mountGamePresentation(
  params: URLSearchParams,
  renderer: WorldRenderer,
): Promise<{ sound: ReturnType<typeof createSoundDriver> | null; hasSignArt: boolean }> {
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
  renderer.setSettlerBubbleGfx(await loadSettlerBubbleGfx());
  const signGfx = await loadBuildingSignGfx();
  renderer.setBuildingSignGfx(signGfx);
  return { sound, hasSignArt: signGfx !== null };
}
