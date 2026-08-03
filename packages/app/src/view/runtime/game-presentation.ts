import type { WorldRenderer } from '@open-northland/render';
import { BUILD_HOUSE_ATOMIC, HARVEST_ATOMIC } from '../../catalog/atomics.js';
import { createSoundDriver } from '../../content/audio.js';
import { loadSettlerBubbleGfx } from '../../content/bubbles.js';
import { loadBuildingSignGfx } from '../../content/building-signs.js';
import { loadIr } from '../../content/ir/load.js';
import { loadCombatBones } from '../../content/objects.js';

/** Load the optional decoded assets the game view's sound and combat rendering share. `hasSignArt`
 *  gates door-badge click picking, whose hit geometry comes from the sign chain. */
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
    // Browsers keep the AudioContext suspended until a gesture grants user activation: pointerdown
    // does so only for mice, so pointerup covers touch and keydown covers the keyboard.
    const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'keydown'] as const;
    const resume = (): void => {
      void sound
        .resume()
        .then(() => {
          if (!sound.started) return;
          for (const event of GESTURE_EVENTS) window.removeEventListener(event, resume);
        })
        // Resuming can throw (e.g. a context-count cap); staying silent beats crashing the view.
        .catch(() => undefined);
    };
    for (const event of GESTURE_EVENTS) window.addEventListener(event, resume);
  }
  renderer.setCombatBonesGfx(ir !== null ? await loadCombatBones(ir) : null);
  renderer.setSettlerBubbleGfx(await loadSettlerBubbleGfx());
  const signGfx = await loadBuildingSignGfx();
  renderer.setBuildingSignGfx(signGfx);
  return { sound, hasSignArt: signGfx !== null };
}
